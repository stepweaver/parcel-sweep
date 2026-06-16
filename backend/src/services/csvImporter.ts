import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db/index.js";
import { exec, queryAll } from "../db/helpers.js";
import { SUNDAY_DEFAULTS } from "../config/sundayDefaults.js";
import {
  ManifestRowInput,
  validateManifestRow,
  summarizeValidation,
} from "./manifestValidator.js";
import { writeAuditEvent } from "./auditService.js";

const CSV_COLUMNS = [
  "tracking_number",
  "recipient_name",
  "address_line_1",
  "address_line_2",
  "city",
  "state",
  "zip",
  "weight_oz",
  "length_in",
  "width_in",
  "height_in",
  "hazmat_flag",
  "sunday_eligible",
  "pod_required",
  "service_type",
  "delivery_notes",
] as const;

function parseBool(val: string | undefined): boolean {
  if (!val) return false;
  const v = val.trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes" || v === "y";
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

export function parseCsvToRows(csvText: string): ManifestRowInput[] {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const header = parseCsvLine(lines[0]).map((h) => h.toLowerCase().replace(/\s+/g, "_"));
  const colIndex = (name: string) => header.indexOf(name);

  const rows: ManifestRowInput[] = [];
  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i]);
    if (fields.every((f) => !f)) continue;

    const get = (col: string) => fields[colIndex(col)] ?? "";

    rows.push({
      trackingNumber: get("tracking_number"),
      recipientName: get("recipient_name") || "Recipient",
      addressLine1: get("address_line_1"),
      addressLine2: get("address_line_2") || undefined,
      city: get("city") || "South Bend",
      state: get("state") || "IN",
      zip: get("zip"),
      weightOz: parseInt(get("weight_oz"), 10) || 16,
      lengthIn: parseInt(get("length_in"), 10) || 0,
      widthIn: parseInt(get("width_in"), 10) || 0,
      heightIn: parseInt(get("height_in"), 10) || 0,
      hazmatFlag: parseBool(get("hazmat_flag")),
      sundayEligible: get("sunday_eligible") ? parseBool(get("sunday_eligible")) : true,
      podRequired: parseBool(get("pod_required")),
      serviceType: get("service_type") || "Priority Mail",
      deliveryNotes: get("delivery_notes") || undefined,
    });
  }
  return rows;
}

export function csvTemplate(): string {
  return [CSV_COLUMNS.join(","), "9400111899223344661401,Jane Doe,123 Main St,Apt 2B,South Bend,IN,46614,16,12,10,8,false,true,false,Priority Mail,Gate code 4421"].join("\n");
}

export interface ImportManifestOptions {
  hubZip: string;
  hubId?: string;
  operationDate?: string;
  dutTime?: string;
  allowedZips?: string[];
  actor?: string;
}

export async function importManifestFromCsv(
  csvText: string,
  options: ImportManifestOptions
): Promise<{ manifestId: string; rowCount: number; summary: Record<string, number>; rejectedCount: number }> {
  const rows = parseCsvToRows(csvText);
  if (rows.length === 0) {
    throw new Error("CSV contains no data rows.");
  }

  const hubZip = options.hubZip.slice(0, 5);
  if (!/^\d{5}$/.test(hubZip)) {
    throw new Error("hubZip must be a 5-digit ZIP.");
  }

  const allowedZips = options.allowedZips ?? SUNDAY_DEFAULTS.multiZipCodes;
  const db = getDb();

  const existing = queryAll<{ tracking_number: string }>(
    db.prepare(`
      SELECT p.tracking_number FROM packages p
      JOIN manifests m ON m.id = p.manifest_id
      WHERE m.status = 'active'
    `)
  );
  const existingTracking = new Set(existing.map((r) => r.tracking_number));
  const seenTracking = new Set<string>();

  const manifestId = uuidv4();
  const now = new Date().toISOString();
  const operationDate = options.operationDate ?? now.slice(0, 10);
  const dutTime = options.dutTime ?? "09:30";

  const validated: Array<ReturnType<typeof validateManifestRow>> = [];
  const rejected: Array<{ row: ManifestRowInput; validation: ReturnType<typeof validateManifestRow> }> = [];
  for (const row of rows) {
    validated.push(
      validateManifestRow(row, {
        hubZip,
        allowedZips: [...allowedZips],
        seenTracking,
        existingTracking,
        skipGeocode: rows.length > 100,
      })
    );
  }

  const summary = summarizeValidation(validated);

  db.exec("BEGIN");
  try {
    exec(
      db.prepare(`
        INSERT INTO manifests
          (id, zip_code, generated_at, total_packages, status, source, hub_id,
           operation_date, dut_time, validation_summary)
        VALUES (?, ?, ?, ?, 'active', 'csv', ?, ?, ?, ?)
      `),
      manifestId,
      hubZip,
      now,
      rows.length,
      options.hubId ?? "chippewa",
      operationDate,
      dutTime,
      JSON.stringify(summary)
    );

    const insertPkg = db.prepare(`
      INSERT INTO packages
        (id, manifest_id, tracking_number, recipient_name, address, address_line_2,
         city, state, zip, lat, lng, package_count, service_type, weight_oz,
         length_in, width_in, height_in, hazmat_flag, oversize_flag, sunday_eligible,
         pod_required, delivery_notes, validation_status, validation_reasons,
         quarantine_status, status, is_ghost, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?)
    `);

    const BATCH = 100;
    let inserted = 0;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const v = validated[i];
      if (v.validationStatus === "duplicate") {
        rejected.push({ row, validation: v });
        continue;
      }
      exec(
        insertPkg,
        uuidv4(),
        manifestId,
        row.trackingNumber.trim(),
        row.recipientName,
        row.addressLine1,
        row.addressLine2 ?? null,
        row.city,
        row.state,
        row.zip.slice(0, 5),
        v.lat,
        v.lng,
        row.serviceType ?? "Priority Mail",
        row.weightOz ?? 16,
        row.lengthIn ?? 0,
        row.widthIn ?? 0,
        row.heightIn ?? 0,
        row.hazmatFlag ? 1 : 0,
        v.oversizeFlag ? 1 : 0,
        row.sundayEligible !== false ? 1 : 0,
        row.podRequired ? 1 : 0,
        row.deliveryNotes ?? null,
        v.validationStatus,
        JSON.stringify(v.validationReasons),
        v.quarantineStatus,
        now
      );
      inserted++;

      if ((i + 1) % BATCH === 0) {
        // keep transaction manageable
      }
    }

    exec(db.prepare(`UPDATE manifests SET total_packages = ? WHERE id = ?`), inserted, manifestId);

    (summary as Record<string, number>).rejected = rejected.length;
    (summary as Record<string, number>).inserted = inserted;

    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  writeAuditEvent({
    entityType: "manifest",
    entityId: manifestId,
    action: "import_csv",
    actor: options.actor ?? "supervisor",
    after: { rowCount: rows.length, summary, rejected: rejected.length },
    reason: "CSV manifest import",
  });

  return { manifestId, rowCount: rows.length, summary, rejectedCount: rejected.length };
}

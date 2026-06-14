/**
 * Route optimizer — nearest-neighbor heuristic followed by 2-opt improvement.
 *
 * The duration matrix has shape (n+1) × (n+1) where index 0 is the depot
 * and indices 1..n correspond to cluster centroids in the order they appear
 * in the `clusters` array.
 *
 * Returns the ordered list of cluster indices (0-based into `clusters`) that
 * represents the optimised visit sequence, starting from the depot.
 */

/**
 * Nearest-neighbour greedy tour.
 *
 * Starts at node 0 (depot), always moves to the closest unvisited cluster,
 * and returns the ordered sequence of cluster indices (0-based, depot excluded).
 */
function nearestNeighbour(matrix: number[][]): number[] {
  const n = matrix.length;
  const visited = new Array<boolean>(n).fill(false);
  const tour: number[] = [];

  let current = 0; // depot is index 0
  visited[0] = true;

  for (let step = 0; step < n - 1; step++) {
    let bestNext = -1;
    let bestDuration = Infinity;

    for (let j = 1; j < n; j++) {
      if (!visited[j] && matrix[current][j] < bestDuration) {
        bestDuration = matrix[current][j];
        bestNext = j;
      }
    }

    if (bestNext === -1) break;
    visited[bestNext] = true;
    tour.push(bestNext);
    current = bestNext;
  }

  return tour;
}

/**
 * Compute total duration of a tour given a sequence of matrix indices.
 * The tour always starts from depot (index 0); the sequence contains only
 * cluster indices (1-based in the matrix).
 */
function tourDuration(tour: number[], matrix: number[][]): number {
  if (tour.length === 0) return 0;
  let total = matrix[0][tour[0]];
  for (let i = 0; i < tour.length - 1; i++) {
    total += matrix[tour[i]][tour[i + 1]];
  }
  return total;
}

/**
 * 2-opt improvement — iteratively reverse sub-sequences of the tour until
 * no swap reduces total duration.  O(n²) per pass; typically converges in
 * a small number of passes for delivery-size problems.
 */
function twoOpt(tour: number[], matrix: number[][]): number[] {
  let improved = true;
  let best = [...tour];
  let bestDuration = tourDuration(best, matrix);

  while (improved) {
    improved = false;
    for (let i = 0; i < best.length - 1; i++) {
      for (let j = i + 1; j < best.length; j++) {
        const candidate = [
          ...best.slice(0, i),
          ...best.slice(i, j + 1).reverse(),
          ...best.slice(j + 1),
        ];
        const candidateDuration = tourDuration(candidate, matrix);
        if (candidateDuration < bestDuration - 1e-6) {
          best = candidate;
          bestDuration = candidateDuration;
          improved = true;
        }
      }
    }
  }

  return best;
}

/**
 * Run the full optimisation pipeline and return the ordered cluster indices
 * (0-based into the original clusters array, depot excluded).
 */
export function optimizeRoute(matrix: number[][]): number[] {
  if (matrix.length <= 1) return []; // only depot, no clusters
  if (matrix.length === 2) return [1]; // single cluster

  const nnTour = nearestNeighbour(matrix);
  const optimized = twoOpt(nnTour, matrix);

  // Convert from matrix indices (1-based) to cluster array indices (0-based)
  return optimized.map((matrixIdx) => matrixIdx - 1);
}

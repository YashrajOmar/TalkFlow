/**
 * Seed data for concept_topics table.
 *
 * These are the foundational algorithmic concepts that the Knowledge Graph
 * tracks mastery for. New topics can be added at any time — they are just
 * rows in the database, not hardcoded into application logic.
 *
 * Categories:
 *   - technique:       Two Pointers, Sliding Window, Binary Search, etc.
 *   - data_structure:  Hash Map, Heap, Segment Tree, etc.
 *   - paradigm:        DP, Greedy, D&C, Backtracking, etc.
 *   - math:            Number Theory, Combinatorics, Geometry, etc.
 */

export const CONCEPT_TOPIC_SEEDS = [
  // ── Techniques ──
  { slug: 'two_pointers', displayName: 'Two Pointers', category: 'technique', description: 'Using two indices to traverse a sorted array or linked list from different positions.' },
  { slug: 'sliding_window', displayName: 'Sliding Window', category: 'technique', description: 'Maintaining a window of elements over a sequence to compute aggregates efficiently.' },
  { slug: 'binary_search', displayName: 'Binary Search', category: 'technique', description: 'Logarithmic search on sorted data or monotonic functions.' },
  { slug: 'prefix_sum', displayName: 'Prefix Sum', category: 'technique', description: 'Precomputing cumulative sums for O(1) range queries.' },
  { slug: 'sorting', displayName: 'Sorting', category: 'technique', description: 'Using sort as a preprocessing step to enable other techniques.' },
  { slug: 'bit_manipulation', displayName: 'Bit Manipulation', category: 'technique', description: 'Operating directly on binary representations of integers.' },
  { slug: 'recursion', displayName: 'Recursion', category: 'technique', description: 'Solving problems by breaking them into smaller subproblems of the same type.' },
  { slug: 'topological_sort', displayName: 'Topological Sort', category: 'technique', description: 'Ordering vertices in a DAG such that every directed edge goes from earlier to later.' },

  // ── Data Structures ──
  { slug: 'hash_map', displayName: 'Hash Map', category: 'data_structure', description: 'O(1) average-case lookup, insertion, and deletion using hashing.' },
  { slug: 'stack', displayName: 'Stack', category: 'data_structure', description: 'LIFO data structure for tracking state, parentheses matching, monotonic problems.' },
  { slug: 'queue', displayName: 'Queue / Deque', category: 'data_structure', description: 'FIFO structure used in BFS, sliding window max/min.' },
  { slug: 'heap', displayName: 'Heap / Priority Queue', category: 'data_structure', description: 'Efficient min/max extraction for greedy algorithms, merge-k problems.' },
  { slug: 'linked_list', displayName: 'Linked List', category: 'data_structure', description: 'Node-based sequential data structure with O(1) insert/delete at known positions.' },
  { slug: 'tree', displayName: 'Tree (General)', category: 'data_structure', description: 'Hierarchical data structures including binary trees, N-ary trees.' },
  { slug: 'binary_search_tree', displayName: 'BST / Balanced BST', category: 'data_structure', description: 'Ordered tree for O(log n) search, insert, delete. AVL, Red-Black, etc.' },
  { slug: 'segment_tree', displayName: 'Segment Tree', category: 'data_structure', description: 'Range query and point update in O(log n) for sums, mins, maxes.' },
  { slug: 'trie', displayName: 'Trie', category: 'data_structure', description: 'Prefix tree for efficient string search, autocomplete, and word problems.' },
  { slug: 'union_find', displayName: 'Union-Find / DSU', category: 'data_structure', description: 'Disjoint set data structure for connected components and cycle detection.' },
  { slug: 'graph', displayName: 'Graph (Adjacency)', category: 'data_structure', description: 'Adjacency list/matrix representation for graph problems.' },

  // ── Paradigms ──
  { slug: 'dynamic_programming', displayName: 'Dynamic Programming', category: 'paradigm', description: 'Optimal substructure + overlapping subproblems. Memoization or tabulation.' },
  { slug: 'greedy', displayName: 'Greedy', category: 'paradigm', description: 'Making locally optimal choices that lead to a globally optimal solution.' },
  { slug: 'divide_and_conquer', displayName: 'Divide & Conquer', category: 'paradigm', description: 'Splitting the problem into independent subproblems, solving recursively, combining.' },
  { slug: 'backtracking', displayName: 'Backtracking', category: 'paradigm', description: 'Systematic exploration of all candidate solutions with pruning.' },
  { slug: 'bfs', displayName: 'BFS', category: 'paradigm', description: 'Breadth-first traversal for shortest path in unweighted graphs and level-order traversal.' },
  { slug: 'dfs', displayName: 'DFS', category: 'paradigm', description: 'Depth-first traversal for connectivity, cycle detection, topological sort.' },
  { slug: 'shortest_path', displayName: 'Shortest Path', category: 'paradigm', description: 'Dijkstra, Bellman-Ford, Floyd-Warshall for weighted graph distances.' },
  { slug: 'mst', displayName: 'Minimum Spanning Tree', category: 'paradigm', description: 'Kruskal or Prim for connecting all vertices with minimum total edge weight.' },

  // ── Math ──
  { slug: 'number_theory', displayName: 'Number Theory', category: 'math', description: 'GCD, LCM, modular arithmetic, primes, sieve of Eratosthenes.' },
  { slug: 'combinatorics', displayName: 'Combinatorics', category: 'math', description: 'Counting, permutations, combinations, inclusion-exclusion.' },
  { slug: 'geometry', displayName: 'Computational Geometry', category: 'math', description: 'Convex hull, line intersection, closest pair of points.' },

  // ── String Processing ──
  { slug: 'string_matching', displayName: 'String Matching', category: 'technique', description: 'KMP, Rabin-Karp, Z-algorithm for pattern searching in strings.' },
  { slug: 'string_hashing', displayName: 'String Hashing', category: 'technique', description: 'Polynomial rolling hash for O(1) substring comparison.' },
] as const;

// ── Prerequisite Graph Seed Data ─────────────────────────────────────────────
//
// Directed edges: { topicSlug → requires → prerequisiteSlug }
// strength 1.0 = hard dependency (cannot meaningfully attempt without this).
// strength 0.7 = strongly recommended (significant overlap).
// strength 0.5 = helpful but not strictly required.
//
// Used to seed the `topic_prerequisites` join table on first deploy.
// Keep in sync with the Drizzle schema in schema.ts.

export interface PrerequisiteEdge {
  /** The advanced topic that has this prerequisite. */
  topicSlug: string;
  /** The prerequisite topic that must be learned first. */
  prerequisiteSlug: string;
  /**
   * How critical this prerequisite is (0.0–1.0).
   * 1.0 = hard dependency; 0.5 = helpful but not strictly required.
   */
  strength: number;
}

export const CONCEPT_TOPIC_PREREQUISITES: PrerequisiteEdge[] = [
  // ── Techniques ──────────────────────────────────────────────────────────────
  // Two Pointers: requires knowing how to sort and index arrays
  { topicSlug: 'two_pointers',      prerequisiteSlug: 'sorting',         strength: 0.7 },

  // Sliding Window: the window invariant is a generalisation of prefix sums
  { topicSlug: 'sliding_window',    prerequisiteSlug: 'prefix_sum',      strength: 0.5 },

  // Topological Sort: needs graph representation + DFS/BFS
  { topicSlug: 'topological_sort',  prerequisiteSlug: 'graph',           strength: 1.0 },
  { topicSlug: 'topological_sort',  prerequisiteSlug: 'dfs',             strength: 0.7 },
  { topicSlug: 'topological_sort',  prerequisiteSlug: 'bfs',             strength: 0.7 },

  // String Matching: understand hashing before rolling-hash variants
  { topicSlug: 'string_matching',   prerequisiteSlug: 'string_hashing',  strength: 0.5 },

  // ── Data Structures ─────────────────────────────────────────────────────────
  // BST: must understand general tree structure first
  { topicSlug: 'binary_search_tree', prerequisiteSlug: 'tree',           strength: 1.0 },
  { topicSlug: 'binary_search_tree', prerequisiteSlug: 'binary_search',  strength: 0.7 },

  // Segment Tree: needs binary search intuition + recursion for build
  { topicSlug: 'segment_tree',      prerequisiteSlug: 'recursion',       strength: 0.8 },
  { topicSlug: 'segment_tree',      prerequisiteSlug: 'binary_search',   strength: 0.9 },
  { topicSlug: 'segment_tree',      prerequisiteSlug: 'prefix_sum',      strength: 0.7 },

  // Trie: needs tree fundamentals and hash map alternatives intuition
  { topicSlug: 'trie',              prerequisiteSlug: 'tree',            strength: 0.9 },
  { topicSlug: 'trie',              prerequisiteSlug: 'hash_map',        strength: 0.5 },

  // Union-Find: used heavily in graph problems, needs graph context
  { topicSlug: 'union_find',        prerequisiteSlug: 'graph',           strength: 0.7 },

  // Heap: priority queue is a specialised tree
  { topicSlug: 'heap',              prerequisiteSlug: 'tree',            strength: 0.5 },

  // ── Paradigms ────────────────────────────────────────────────────────────────
  // DFS/BFS both require understanding graph representation
  { topicSlug: 'dfs',              prerequisiteSlug: 'graph',            strength: 1.0 },
  { topicSlug: 'dfs',              prerequisiteSlug: 'recursion',        strength: 0.8 },
  { topicSlug: 'bfs',              prerequisiteSlug: 'graph',            strength: 1.0 },
  { topicSlug: 'bfs',              prerequisiteSlug: 'queue',            strength: 0.9 },

  // Shortest Path: needs graph + greedy intuition (Dijkstra is greedy BFS)
  { topicSlug: 'shortest_path',    prerequisiteSlug: 'graph',            strength: 1.0 },
  { topicSlug: 'shortest_path',    prerequisiteSlug: 'heap',             strength: 0.7 },
  { topicSlug: 'shortest_path',    prerequisiteSlug: 'bfs',              strength: 0.7 },

  // MST: Kruskal needs Union-Find; Prim needs Heap + greedy
  { topicSlug: 'mst',              prerequisiteSlug: 'graph',            strength: 1.0 },
  { topicSlug: 'mst',              prerequisiteSlug: 'union_find',       strength: 0.8 },
  { topicSlug: 'mst',              prerequisiteSlug: 'heap',             strength: 0.7 },

  // DP: requires strong recursion and memoisation intuition
  { topicSlug: 'dynamic_programming', prerequisiteSlug: 'recursion',     strength: 1.0 },

  // Divide & Conquer: fundamentally recursive
  { topicSlug: 'divide_and_conquer',  prerequisiteSlug: 'recursion',     strength: 1.0 },
  { topicSlug: 'divide_and_conquer',  prerequisiteSlug: 'sorting',       strength: 0.5 },

  // Backtracking: recursive search with state, builds on DFS pattern
  { topicSlug: 'backtracking',     prerequisiteSlug: 'recursion',        strength: 1.0 },
  { topicSlug: 'backtracking',     prerequisiteSlug: 'dfs',              strength: 0.7 },

  // Greedy: often needs sorting as a first step
  { topicSlug: 'greedy',           prerequisiteSlug: 'sorting',          strength: 0.7 },

  // ── Math ─────────────────────────────────────────────────────────────────────
  // Combinatorics often combined with DP (counting paths, sequences)
  { topicSlug: 'combinatorics',    prerequisiteSlug: 'dynamic_programming', strength: 0.5 },
  { topicSlug: 'combinatorics',    prerequisiteSlug: 'number_theory',       strength: 0.7 },

  // Geometry: usually requires sorting (convex hull, sweep line)
  { topicSlug: 'geometry',         prerequisiteSlug: 'sorting',          strength: 0.7 },
];

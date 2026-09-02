export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export function toSkipTake(page = 1, limit = 20) {
  return { skip: (page - 1) * limit, take: limit };
}

export function paginate<T>(data: T[], total: number, page = 1, limit = 20): PaginatedResult<T> {
  return { data, total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) };
}

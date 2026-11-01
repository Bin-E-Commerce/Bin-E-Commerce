// Hợp đồng SQL tối thiểu dùng chung cho repository import thương hiệu.
export interface QueryResult<T extends object> {
    rows: T[];
}

export interface DatabaseExecutor {
    query<T extends object = Record<string, unknown>>(
        sql: string,
        params?: unknown[],
    ): Promise<QueryResult<T>>;
}

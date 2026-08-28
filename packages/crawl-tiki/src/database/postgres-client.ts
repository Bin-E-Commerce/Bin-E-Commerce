import { Client } from 'pg';
import type { QueryResultRow } from 'pg';
import type {
    DatabaseExecutor,
    QueryResult,
} from '../repositories/postgres-product-import.repository';

export class PostgresClient implements DatabaseExecutor {
    private readonly client: Client;
    private connected = false;

    constructor(connectionString: string) {
        this.client = new Client({ connectionString });
    }

    // Mở một kết nối duy nhất để các lệnh BEGIN/COMMIT trong repository chạy cùng connection.
    async connect(): Promise<void> {
        if (this.connected) return;
        await this.client.connect();
        this.connected = true;
    }

    // Thực thi SQL qua cùng một client, giữ interface nhỏ để repository dễ test/mock.
    async query<T extends QueryResultRow = Record<string, unknown>>(
        sql: string,
        params?: unknown[],
    ): Promise<QueryResult<T>> {
        await this.connect();
        return this.client.query<T>(sql, params);
    }

    // Đóng kết nối sau khi job hoàn tất để process CLI thoát sạch.
    async close(): Promise<void> {
        if (!this.connected) return;
        await this.client.end();
        this.connected = false;
    }
}

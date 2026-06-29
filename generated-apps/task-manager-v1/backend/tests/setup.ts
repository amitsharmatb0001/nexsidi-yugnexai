import { Pool } from 'pg';
import { Pool as MockPool } from 'pg';

jest.mock('pg', () => {
  const mockQuery = jest.fn().mockResolvedValue({ rows: [] });
  const mockPool = jest.fn().mockImplementation(() => ({
    query: mockQuery,
    end: jest.fn(),
    connect: jest.fn()
  }));
  return {
    Pool: mockPool,
    __mockQuery: mockQuery
  };
});

beforeAll(() => {
  process.env.DATABASE_URL = 'postgresql://localhost/test';
});

afterAll(async () => {
  jest.clearAllMocks();
});

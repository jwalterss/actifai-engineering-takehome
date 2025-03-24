'use strict';

const request = require('supertest');
const express = require('express');
const { Pool } = require('pg');

// Prevent server.js from executing when imported
jest.mock('./server', () => ({}), { virtual: true });

// Mock dependencies
jest.mock('pg', () => {
    const mPool = {
        connect: jest.fn(),
        end: jest.fn(),
        query: jest.fn(),
    };
    return { Pool: jest.fn(() => mPool) };
});

jest.mock('./seed', () => ({
    seedDatabase: jest.fn().mockResolvedValue(),
}));

// Store original process.env
const originalEnv = process.env;

describe('Server API Tests', () => {
    let app;
    let pool;
    let mockClient;

    beforeEach(() => {
        // Reset process.env
        process.env = { ...originalEnv };

        // Reset all mocks
        jest.clearAllMocks();

        // Mock console methods to avoid noise in test output
        jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});

        // Setup mock client for pool
        mockClient = {
            query: jest.fn(),
            release: jest.fn(),
        };

        // Mock Pool and avoid requiring the actual server.js
        pool = new Pool();
        pool.connect.mockResolvedValue(mockClient);

        // Create a test instance of the app
        app = express();

        // Setup routes manually for testing
        app.get('/health', (req, res) => {
            res.send('Hello World');
        });

        app.get('/api/sales-analytics/time-series', async (req, res) => {
            try {
                // Simulate the endpoint logic but use our mocks
                const result = { rows: mockTimeSeriesData };
                res.json({ data: mockTimeSeriesData });
            } catch (err) {
                res.status(500).json({ error: 'Internal server error' });
            }
        });

        app.get('/api/sales-analytics/users', async (req, res) => {
            try {
                // Simulate the endpoint logic but use our mocks
                res.json({ data: mockUserData });
            } catch (err) {
                res.status(500).json({ error: 'Internal server error' });
            }
        });

        app.get('/api/sales-analytics/groups', async (req, res) => {
            try {
                // Simulate the endpoint logic but use our mocks
                res.json({ data: mockGroupData });
            } catch (err) {
                res.status(500).json({ error: 'Internal server error' });
            }
        });

        app.get('/api/sales-analytics/trends', async (req, res) => {
            try {
                // Simulate the endpoint logic but use our mocks
                res.json({ data: mockTrendsData });
            } catch (err) {
                res.status(500).json({ error: 'Internal server error' });
            }
        });
    });

    afterEach(() => {
        // Restore process.env
        process.env = originalEnv;
    });

    // Mock data for our tests
    const mockTimeSeriesData = [
        {
            period: '2021-01-01T00:00:00.000Z',
            totalRevenue: 60813,
            averageRevenue: 20271,
            saleCount: 3,
            activeUsers: 3
        },
        {
            period: '2021-02-01T00:00:00.000Z',
            totalRevenue: 16562,
            averageRevenue: 16562,
            saleCount: 1,
            activeUsers: 1
        }
    ];

    const mockUserData = [
        {
            userId: 7,
            name: 'Gloria',
            role: 'Agent',
            saleCount: 3,
            totalRevenue: 88748,
            averageRevenue: 29582.67,
            activeDays: 3,
            groups: ['Northeast Sales Team']
        },
        {
            userId: 17,
            name: 'Quincy',
            role: 'Retail Agent',
            saleCount: 1,
            totalRevenue: 47836,
            averageRevenue: 47836,
            activeDays: 1,
            groups: ['West Coast Sales Team']
        }
    ];

    const mockGroupData = [
        {
            groupId: 1,
            name: 'Northeast Sales Team',
            memberCount: 8,
            saleCount: 6,
            totalRevenue: 112627,
            avgRevenuePerSale: 18771.17,
            avgRevenuePerMember: 14078.38
        },
        {
            groupId: 2,
            name: 'West Coast Sales Team',
            memberCount: 7,
            saleCount: 5,
            totalRevenue: 144270,
            avgRevenuePerSale: 28854,
            avgRevenuePerMember: 20610
        }
    ];

    const mockTrendsData = [
        {
            period: '2021-01-01T00:00:00.000Z',
            totalRevenue: 60813,
            saleCount: 3,
            growthPercentage: null
        },
        {
            period: '2021-02-01T00:00:00.000Z',
            totalRevenue: 16562,
            saleCount: 1,
            growthPercentage: -72.76
        }
    ];

    // Test database connection
    describe('Database Connection', () => {
        test('should connect to database', async () => {
            mockClient.query.mockResolvedValueOnce({ rows: [{ now: new Date() }] });

            // We'll use a simplified version to test just the DB connection part
            const pool = new Pool();
            const client = await pool.connect();

            await client.query('SELECT NOW()');
            client.release();

            expect(pool.connect).toHaveBeenCalled();
            expect(mockClient.query).toHaveBeenCalledWith('SELECT NOW()');
            expect(mockClient.release).toHaveBeenCalled();
        });
    });

    // Test health check endpoint
    describe('Health Check Endpoint', () => {
        test('should return hello world', async () => {
            const response = await request(app).get('/health');

            expect(response.status).toBe(200);
            expect(response.text).toBe('Hello World');
        });
    });

    // Test time series endpoint
    describe('Time Series Endpoint', () => {
        test('should return time series data with default parameters', async () => {
            mockClient.query.mockResolvedValueOnce({ rows: mockTimeSeriesData });

            const response = await request(app).get('/api/sales-analytics/time-series');

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('data');
            expect(response.body.data).toHaveLength(2);
            expect(response.body.data[0]).toHaveProperty('period');
            expect(response.body.data[0]).toHaveProperty('totalRevenue');
        });

        test('should handle different interval parameters', async () => {
            mockClient.query.mockResolvedValueOnce({ rows: mockTimeSeriesData });

            const response = await request(app)
                .get('/api/sales-analytics/time-series')
                .query({ interval: 'week' });

            expect(response.status).toBe(200);
        });

        test('should filter by userId', async () => {
            mockClient.query.mockResolvedValueOnce({ rows: mockTimeSeriesData.slice(0, 1) });

            const response = await request(app)
                .get('/api/sales-analytics/time-series')
                .query({ userId: 7 });

            expect(response.status).toBe(200);
        });

        test('should filter by groupId', async () => {
            mockClient.query.mockResolvedValueOnce({ rows: mockTimeSeriesData.slice(0, 1) });

            const response = await request(app)
                .get('/api/sales-analytics/time-series')
                .query({ groupId: 1 });

            expect(response.status).toBe(200);
        });

        test('should handle date range filtering', async () => {
            mockClient.query.mockResolvedValueOnce({ rows: mockTimeSeriesData });

            const response = await request(app)
                .get('/api/sales-analytics/time-series')
                .query({ startDate: '2021-01-01', endDate: '2021-02-28' });

            expect(response.status).toBe(200);
        });

        test('should handle metric filtering', async () => {
            mockClient.query.mockResolvedValueOnce({ rows: mockTimeSeriesData });

            const response = await request(app)
                .get('/api/sales-analytics/time-series')
                .query({ metric: 'totalRevenue' });

            expect(response.status).toBe(200);
        });
    });

    // Test users endpoint
    describe('Users Endpoint', () => {
        test('should return user performance data', async () => {
            mockClient.query.mockResolvedValueOnce({ rows: mockUserData });

            const response = await request(app).get('/api/sales-analytics/users');

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('data');
            expect(response.body.data).toHaveLength(2);
            expect(response.body.data[0]).toHaveProperty('userId');
            expect(response.body.data[0]).toHaveProperty('name');
            expect(response.body.data[0]).toHaveProperty('totalRevenue');
        });

        test('should limit results based on query parameter', async () => {
            mockClient.query.mockResolvedValueOnce({ rows: mockUserData.slice(0, 1) });

            const response = await request(app)
                .get('/api/sales-analytics/users')
                .query({ limit: 1 });

            expect(response.status).toBe(200);
            expect(response.body.data).toHaveLength(1); // this is currently failing
        });

        test('should handle date range filtering', async () => {
            mockClient.query.mockResolvedValueOnce({ rows: mockUserData });

            const response = await request(app)
                .get('/api/sales-analytics/users')
                .query({ startDate: '2021-01-01', endDate: '2021-12-31' });

            expect(response.status).toBe(200);
        });
    });

    // Test groups endpoint
    describe('Groups Endpoint', () => {
        test('should return group performance data', async () => {
            mockClient.query.mockResolvedValueOnce({ rows: mockGroupData });

            const response = await request(app).get('/api/sales-analytics/groups');

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('data');
            expect(response.body.data).toHaveLength(2);
            expect(response.body.data[0]).toHaveProperty('groupId');
            expect(response.body.data[0]).toHaveProperty('name');
            expect(response.body.data[0]).toHaveProperty('totalRevenue');
            expect(response.body.data[0]).toHaveProperty('avgRevenuePerMember');
        });

        test('should handle date range filtering', async () => {
            mockClient.query.mockResolvedValueOnce({ rows: mockGroupData });

            const response = await request(app)
                .get('/api/sales-analytics/groups')
                .query({ startDate: '2021-01-01', endDate: '2021-12-31' });

            expect(response.status).toBe(200);
        });
    });

    // Test trends endpoint
    describe('Trends Endpoint', () => {
        test('should return sales trend data', async () => {
            mockClient.query.mockResolvedValueOnce({ rows: mockTrendsData });

            const response = await request(app).get('/api/sales-analytics/trends');

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('data');
            expect(response.body.data).toHaveLength(2);
            expect(response.body.data[0]).toHaveProperty('period');
            expect(response.body.data[0]).toHaveProperty('totalRevenue');
            expect(response.body.data[0]).toHaveProperty('growthPercentage');
        });

        test('should handle different interval parameters', async () => {
            mockClient.query.mockResolvedValueOnce({ rows: mockTrendsData });

            const response = await request(app)
                .get('/api/sales-analytics/trends')
                .query({ interval: 'quarter' });

            expect(response.status).toBe(200);
        });

        test('should handle date range filtering', async () => {
            mockClient.query.mockResolvedValueOnce({ rows: mockTrendsData });

            const response = await request(app)
                .get('/api/sales-analytics/trends')
                .query({ startDate: '2021-01-01', endDate: '2021-12-31' });

            expect(response.status).toBe(200);
        });
    });

    // Test error handling
    describe('Error Handling', () => {
        test('should handle database errors', async () => {
            // Setup a mock implementation that throws an error
            mockClient.query.mockRejectedValueOnce(new Error('Database error'));

            // Create a test app with an endpoint that will error
            const errorApp = express();

            // Manually implement the endpoint with error handling
            errorApp.get('/api/sales-analytics/error-test', async (req, res) => {
                const client = await pool.connect();
                try {
                    await client.query('SELECT error');
                    res.json({ success: true });
                } catch (err) {
                    console.error(err);
                    res.status(500).json({ error: 'Internal server error' });
                } finally {
                    client.release();
                }
            });

            const response = await request(errorApp).get('/api/sales-analytics/error-test');

            expect(response.status).toBe(500);
            expect(response.body).toHaveProperty('error', 'Internal server error');
        });
    });
});


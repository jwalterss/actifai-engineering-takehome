'use strict';

const express = require('express');
const { Pool } = require('pg');
const seeder = require('./seed');

// Constants
const PORT = 3000;
const HOST = '0.0.0.0';

// Database pool configuration
const pool = new Pool({
  host: 'db',
  port: '5432',
  user: 'user',
  password: 'pass',
  database: 'actifai',
  max: 20,                       // Maximum number of clients in the pool
  idleTimeoutMillis: 30000,      // Time (ms) before idle clients are closed
  connectionTimeoutMillis: 2000, // Time (ms) to wait for a connection before timeout
});

async function start() {
  // Test database connection
  const client = await pool.connect();
  try {
    await client.query('SELECT NOW()'); // Simple query to test connectivity, returns current timestamp
    console.log('Database connected');
  } finally {
    client.release(); // Release the client back to the pool
  }

  // Seed the database with initial data
  await seeder.seedDatabase();

  // App
  const app = express();

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.send('Hello World');
  });

  // 1. Time series sales analytics endpoint
  app.get('/api/sales-analytics/time-series', async (req, res) => {
    const client = await pool.connect();
    try {
      const { startDate = '2021-01-01', endDate, interval = 'month', userId, groupId, metric = 'all' } = req.query;
      const end = endDate || new Date().toISOString().split('T')[0]; // Default to today if endDate not provided
      const validIntervals = ['day', 'week', 'month', 'quarter', 'year'];
      const timeInterval = validIntervals.includes(interval) ? interval : 'month'; // Ensure valid interval

      let whereClauses = ['s.date >= $1', 's.date <= $2']; // Base WHERE conditions for date range
      const params = [startDate, end];

      if (userId) {
        whereClauses.push('s.user_id = $' + (params.length + 1)); // Filter by user ID
        params.push(parseInt(userId));
      }
      if (groupId) {
        whereClauses.push('ug.group_id = $' + (params.length + 1)); // Filter by group ID
        params.push(parseInt(groupId));
      }

      // Query explanation:
      // - DATE_TRUNC groups sales by the specified time interval (e.g., month)
      // - COUNT(s.id) counts total sales per period
      // - SUM(s.amount) calculates total revenue per period
      // - AVG(s.amount) computes average sale amount, rounded to 2 decimal places
      // - COUNT(DISTINCT s.user_id) counts unique users making sales
      // - JOIN with users table to get user details
      // - Optional JOIN with user_groups if groupId filter is applied
      // - WHERE clause filters by date range and optional user/group conditions
      // - GROUP BY aggregates data by time period
      // - ORDER BY ensures chronological order
      const query = `
        SELECT 
          DATE_TRUNC('${timeInterval}', s.date) as period,
          COUNT(s.id) as sale_count,
          SUM(s.amount) as total_revenue,
          AVG(s.amount)::numeric(10,2) as avg_revenue,
          COUNT(DISTINCT s.user_id) as active_users
        FROM sales s
        JOIN users u ON s.user_id = u.id
        ${groupId ? 'JOIN user_groups ug ON u.id = ug.user_id' : ''} 
        WHERE ${whereClauses.join(' AND ')}
        GROUP BY DATE_TRUNC('${timeInterval}', s.date)
        ORDER BY period ASC;
      `;

      const result = await client.query(query, params);

      // Transform result to include only requested metrics
      const responseData = result.rows.map(row => ({
        period: row.period,
        ...(metric === 'all' || metric === 'totalRevenue' ? { totalRevenue: parseFloat(row.total_revenue) } : {}),
        ...(metric === 'all' || metric === 'avgRevenue' ? { averageRevenue: parseFloat(row.avg_revenue) } : {}),
        ...(metric === 'all' || metric === 'saleCount' ? { saleCount: parseInt(row.sale_count) } : {}),
        ...(metric === 'all' ? { activeUsers: parseInt(row.active_users) } : {})
      }));

      res.json({ data: responseData });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Internal server error' });
    } finally {
      client.release();
    }
  });

  // 2. User performance analysis endpoint
  app.get('/api/sales-analytics/users', async (req, res) => {
    const client = await pool.connect();
    try {
      const { startDate = '2021-01-01', endDate, limit = 10 } = req.query;
      const end = endDate || new Date().toISOString().split('T')[0];

      // Query explanation:
      // - SELECT includes user details (id, name, role) and performance metrics
      // - COUNT(s.id) counts total sales per user
      // - SUM(s.amount) calculates total revenue per user
      // - AVG(s.amount) computes average sale amount per user
      // - COUNT(DISTINCT DATE_TRUNC) counts unique days with sales (active days)
      // - json_agg(g.name) aggregates group names into a JSON array
      // - LEFT JOIN with sales filters by date range and allows users with 0 sales
      // - LEFT JOIN with user_groups and groups to get group affiliations
      // - GROUP BY user details to aggregate per user
      // - ORDER BY total_revenue DESC prioritizes top performers (NULLS LAST handles users with no sales)
      // - LIMIT restricts to top N users
      const query = `
        SELECT 
          u.id,
          u.name,
          u.role,
          COUNT(s.id) as sale_count,
          SUM(s.amount) as total_revenue,
          AVG(s.amount)::numeric(10,2) as avg_revenue,
          COUNT(DISTINCT DATE_TRUNC('day', s.date)) as active_days,
          json_agg(g.name) as groups
        FROM users u
        LEFT JOIN sales s ON u.id = s.user_id AND s.date BETWEEN $1 AND $2
        LEFT JOIN user_groups ug ON u.id = ug.user_id
        LEFT JOIN groups g ON ug.group_id = g.id
        GROUP BY u.id, u.name, u.role
        ORDER BY total_revenue DESC NULLS LAST
        LIMIT $3;
      `;

      const result = await client.query(query, [startDate, end, parseInt(limit)]);

      // Transform result to clean up data types and filter null groups
      res.json({
        data: result.rows.map(row => ({
          userId: row.id,
          name: row.name,
          role: row.role,
          saleCount: parseInt(row.sale_count),
          totalRevenue: parseFloat(row.total_revenue) || 0,
          averageRevenue: parseFloat(row.avg_revenue) || 0,
          activeDays: parseInt(row.active_days),
          groups: row.groups.filter(g => g !== null) // Remove nulls from users not in groups
        }))
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Internal server error' });
    } finally {
      client.release();
    }
  });

  // 3. Group performance comparison endpoint
  app.get('/api/sales-analytics/groups', async (req, res) => {
    const client = await pool.connect();
    try {
      const { startDate = '2021-01-01', endDate } = req.query;
      const end = endDate || new Date().toISOString().split('T')[0];

      // Query explanation:
      // - SELECT includes group details (id, name) and performance metrics
      // - COUNT(DISTINCT ug.user_id) counts unique members per group
      // - COUNT(s.id) counts total sales per group
      // - SUM(s.amount) calculates total revenue per group
      // - AVG(s.amount) computes average sale amount
      // - SUM(s.amount) / COUNT(DISTINCT ug.user_id) calculates revenue per member
      // - LEFT JOIN ensures all groups are included, even those with no sales
      // - WHERE filters sales by date range
      // - GROUP BY aggregates by group
      // - ORDER BY total_revenue DESC prioritizes top-performing groups (NULLS LAST for no sales)
      const query = `
        SELECT 
          g.id,
          g.name,
          COUNT(DISTINCT ug.user_id) as member_count,
          COUNT(s.id) as sale_count,
          SUM(s.amount) as total_revenue,
          AVG(s.amount)::numeric(10,2) as avg_revenue_per_sale,
          SUM(s.amount)::numeric / COUNT(DISTINCT ug.user_id) as avg_revenue_per_member
        FROM groups g
        LEFT JOIN user_groups ug ON g.id = ug.group_id
        LEFT JOIN sales s ON ug.user_id = s.user_id AND s.date BETWEEN $1 AND $2
        GROUP BY g.id, g.name
        ORDER BY total_revenue DESC NULLS LAST;
      `;

      const result = await client.query(query, [startDate, end]);

      // Transform result to clean up data types
      res.json({
        data: result.rows.map(row => ({
          groupId: row.id,
          name: row.name,
          memberCount: parseInt(row.member_count),
          saleCount: parseInt(row.sale_count),
          totalRevenue: parseFloat(row.total_revenue) || 0,
          avgRevenuePerSale: parseFloat(row.avg_revenue_per_sale) || 0,
          avgRevenuePerMember: parseFloat(row.avg_revenue_per_member) || 0
        }))
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Internal server error' });
    } finally {
      client.release();
    }
  });

  // 4. Sales trends and statistics endpoint
  app.get('/api/sales-analytics/trends', async (req, res) => {
    const client = await pool.connect();
    try {
      const { startDate = '2021-01-01', endDate, interval = 'month' } = req.query;
      const end = endDate || new Date().toISOString().split('T')[0];
      const validIntervals = ['day', 'week', 'month', 'quarter', 'year'];
      const timeInterval = validIntervals.includes(interval) ? interval : 'month';

      // Query explanation:
      // - WITH stats CTE (Common Table Expression) calculates base metrics per period
      //   - DATE_TRUNC groups sales by time interval
      //   - SUM(s.amount) computes total revenue
      //   - COUNT(s.id) counts sales
      //   - LAG(SUM(s.amount)) gets the previous period's revenue for growth calculation
      // - Main query:
      //   - Selects period, revenue, and sale count
      //   - CASE calculates growth percentage: (current - previous) / previous * 100
      //   - WHERE filters by date range
      //   - ORDER BY ensures chronological order
      const query = `
        WITH stats AS (
          SELECT 
            DATE_TRUNC('${timeInterval}', s.date) as period,
            SUM(s.amount) as total_revenue,
            COUNT(s.id) as sale_count,
            LAG(SUM(s.amount)) OVER (ORDER BY DATE_TRUNC('${timeInterval}', s.date)) as prev_revenue
          FROM sales s
          WHERE s.date BETWEEN $1 AND $2
          GROUP BY DATE_TRUNC('${timeInterval}', s.date)
        )
        SELECT 
          period,
          total_revenue,
          sale_count,
          CASE 
            WHEN prev_revenue IS NOT NULL 
            THEN ((total_revenue - prev_revenue) / prev_revenue * 100)::numeric(10,2)
            ELSE NULL 
          END as growth_percentage
        FROM stats
        ORDER BY period ASC;
      `;

      const result = await client.query(query, [startDate, end]);

      // Transform result to clean up data types
      res.json({
        data: result.rows.map(row => ({
          period: row.period,
          totalRevenue: parseFloat(row.total_revenue),
          saleCount: parseInt(row.sale_count),
          growthPercentage: row.growth_percentage !== null ? parseFloat(row.growth_percentage) : null
        }))
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Internal server error' });
    } finally {
      client.release();
    }
  });

  // Handle server shutdown gracefully
  process.on('SIGTERM', async () => {
    await pool.end();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    await pool.end();
    process.exit(0);
  });

  app.listen(PORT, HOST);
  console.log(`Server is running on http://${HOST}:${PORT}`);
}

start().catch(async (err) => {
  console.error('Startup error:', err);
  await pool.end();
  process.exit(1);
});
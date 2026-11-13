require('reflect-metadata')
const { Controller, Get, Module, ServiceUnavailableException } = require('@nestjs/common')
const { NestFactory } = require('@nestjs/core')
const next = require('next')
const { Pool } = require('pg')

const port = Number(process.env.PORT || 3000)
const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 3000, statement_timeout: 3000, max: 2 })
  : null
pool?.on('error', () => console.error('Idle database connection failed'))

class HealthController {
  health() {
    return { status: 'ok', framework: 'NestJS', version: '3.0.0' }
  }

  async database() {
    if (!pool) throw new ServiceUnavailableException('database_not_configured')
    let client
    try {
      client = await pool.connect()
      await client.query('BEGIN')
      await client.query('CREATE TEMP TABLE familylink_probe (value text) ON COMMIT DROP')
      await client.query('INSERT INTO familylink_probe VALUES ($1)', ['familylink'])
      const { rows } = await client.query('SELECT value FROM familylink_probe')
      if (rows[0]?.value !== 'familylink') throw new Error('Unexpected probe result')
      await client.query('ROLLBACK')
      client.release()
      return { status: 'ok', database: 'PostgreSQL', test: 'write_read_rollback' }
    } catch (error) {
      client?.release(true)
      console.error('Database probe failed', error.code || error.name)
      throw new ServiceUnavailableException('database_probe_failed')
    }
  }
}

Controller()(HealthController)
for (const [method, path] of [['health', 'health'], ['database', 'health/db']]) {
  Get(path)(HealthController.prototype, method, Object.getOwnPropertyDescriptor(HealthController.prototype, method))
}

class AppModule {}
Module({ controllers: [HealthController] })(AppModule)

async function start() {
  const web = next({ dev: false, hostname: '0.0.0.0', port })
  await web.prepare()
  const app = await NestFactory.create(AppModule)
  app.setGlobalPrefix('api/v1')
  app.getHttpAdapter().getInstance().use((req, res, proceed) => {
    if (req.path.startsWith('/api/')) return proceed()
    web.getRequestHandler()(req, res).catch(proceed)
  })
  await app.listen(port, '0.0.0.0')
}
start().catch(error => {
  console.error(error)
  process.exit(1)
})

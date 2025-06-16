import consola from 'consola'
import { env, s3 } from 'bun'
import { Hono } from 'hono'
import { $ } from 'bun'

const app = new Hono()

app.get('/', (c) => c.text('Howdy!'))

const readCaddyfile = async () => {
  try {
    return await Bun.file('./Caddyfile').text()
  } catch (error) {
    consola.error('Failed to read Caddyfile:', error)
    return null
  }
}

const writeCaddyfile = async (content: string) => {
  try {
    await Bun.write('./Caddyfile', content)
    return true
  } catch (error) {
    consola.error('Failed to write Caddyfile:', error)
    return false
  }
}

const reloadCaddy = async () => {
  try {
    await $`docker exec caddy caddy reload --config /etc/caddy/Caddyfile`
    return true
  } catch (error) {
    consola.error('Failed to reload Caddy:', error)
    return false
  }
}

const parseCaddyfile = (content: string) => {
  const domains = []
  const lines = content.split('\n')
  let currentDomain = null
  let braceCount = 0
  let inBlock = false

  for (const line of lines) {
    const trimmed = line.trim()

    if (!inBlock && trimmed && !trimmed.startsWith('#') && trimmed.includes(' {')) {
      //@ts-ignore
      currentDomain = trimmed.split(' {')[0].trim()
      braceCount = 1
      inBlock = true
    } else if (inBlock) {
      braceCount += (trimmed.match(/{/g) || []).length
      braceCount -= (trimmed.match(/}/g) || []).length

      if (braceCount === 0) {
        if (currentDomain) {
          domains.push(currentDomain)
        }
        currentDomain = null
        inBlock = false
      }
    }
  }

  return domains
}

const domainExists = (content: string, domain: string) => {
  const domains = parseCaddyfile(content)
  return domains.includes(domain)
}

const removeDomainFromCaddyfile = (content: string, domainToRemove: string) => {
  const lines = content.split('\n')
  const result = []
  let inTargetBlock = false
  let braceCount = 0
  let skipBlock = false

  for (const line of lines) {
    const trimmed = line.trim()

    if (!inTargetBlock && trimmed.startsWith(domainToRemove + ' {')) {
      inTargetBlock = true
      skipBlock = true
      braceCount = 1
      continue
    }

    if (inTargetBlock) {
      braceCount += (trimmed.match(/{/g) || []).length
      braceCount -= (trimmed.match(/}/g) || []).length

      if (braceCount === 0) {
        inTargetBlock = false
        skipBlock = false
        continue
      }
    }

    if (!skipBlock) {
      result.push(line)
    }
  }

  return result.join('\n').replace(/\n\n+/g, '\n\n').trim() + '\n'
}

app.post('/domains', async (c) => {
  const { domain, target } = await c.req.json()

  if (!domain || !target) {
    return c.json({ error: 'Domain and target are required' }, 400)
  }

  const currentConfig = await readCaddyfile()
  if (!currentConfig) {
    return c.json({ error: 'Failed to read current config' }, 500)
  }

  if (domainExists(currentConfig, domain)) {
    return c.json({ error: 'Domain already exists' }, 400)
  }

  const newDomainConfig = `
${domain} {
    reverse_proxy ${target} {
        header_up Host ${new URL(target).host}

        @404 status 404
        handle_response @404 {
            respond "Custom 404 - Page not found" 404
        }

        @5xx status 5xx
        handle_response @5xx {
            respond "Site is temporarily down. Please try again later." 503
        }

        @timeout status 502 503 504
        handle_response @timeout {
            respond "Site is temporarily unavailable. We'll be back soon!" 503
        }
    }
}
`

  const updatedConfig = currentConfig.trim() + newDomainConfig

  if (!(await writeCaddyfile(updatedConfig))) {
    return c.json({ error: 'Failed to update config' }, 500)
  }

  if (!(await reloadCaddy())) {
    await writeCaddyfile(currentConfig)
    return c.json({ error: 'Failed to reload Caddy, reverted changes' }, 500)
  }

  return c.json({ message: 'Domain added successfully', domain, target })
})

app.delete('/domains/:domain', async (c) => {
  const domain = c.req.param('domain')

  const currentConfig = await readCaddyfile()
  if (!currentConfig) {
    return c.json({ error: 'Failed to read current config' }, 500)
  }

  if (!domainExists(currentConfig, domain)) {
    return c.json({ error: 'Domain not found' }, 404)
  }

  const updatedConfig = removeDomainFromCaddyfile(currentConfig, domain)

  if (!(await writeCaddyfile(updatedConfig))) {
    return c.json({ error: 'Failed to update config' }, 500)
  }

  if (!(await reloadCaddy())) {
    await writeCaddyfile(currentConfig)
    return c.json({ error: 'Failed to reload Caddy, reverted changes' }, 500)
  }

  return c.json({ message: 'Domain removed successfully', domain })
})

app.get('/domains', async (c) => {
  const currentConfig = await readCaddyfile()
  if (!currentConfig) {
    return c.json({ error: 'Failed to read current config' }, 500)
  }

  const domains = parseCaddyfile(currentConfig)
  return c.json({ domains })
})

app.post('/backup-caddyfile-to-s3', async (c) => {
  const currentConfig = await readCaddyfile()
  if (!currentConfig) throw new Error('Failed to read current config')

  const filePath = `/caddy-backup/${new Date().toISOString().replace(/[:.]/g, '-')}/${Bun.randomUUIDv7()}-Caddyfile`
  const fileBuffer = new TextEncoder().encode(currentConfig)

  await s3.write(filePath, fileBuffer, {
    type: 'text/plain',
  })

  const fileUrl = s3.presign(filePath, {
    expiresIn: 60 * 60, // 1 hour
  })

  return c.json({ message: 'Caddyfile backup created', url: fileUrl })
})

app.onError((err, c) => {
  consola.error('Error occurred:', err)
  return c.json(err, 500)
})

const server = Bun.serve({
  port: env.PORT,
  fetch: app.fetch,
})

consola.success(`Server is running at ${server.url}`)

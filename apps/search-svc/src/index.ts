import { createApp, loadEnv, portEnv } from '@viora/service-kit'

const env = loadEnv('search-svc', { PORT: portEnv(13009) })
const app = createApp('search-svc')

export default { port: env.PORT, fetch: app.fetch }

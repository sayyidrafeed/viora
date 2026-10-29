import { createApp, loadEnv, portEnv } from '@viora/service-kit'

const env = loadEnv('feed-svc', { PORT: portEnv(13006) })
const app = createApp('feed-svc')

export default { port: env.PORT, fetch: app.fetch }

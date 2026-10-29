import { createApp, loadEnv, portEnv } from '@viora/service-kit'

const env = loadEnv('notification-svc', { PORT: portEnv(13010) })
const app = createApp('notification-svc')

export default { port: env.PORT, fetch: app.fetch }

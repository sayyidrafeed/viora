import { createApp, loadEnv, portEnv } from '@viora/service-kit'

const env = loadEnv('live-svc', { PORT: portEnv(13011) })
const app = createApp('live-svc')

export default { port: env.PORT, fetch: app.fetch }

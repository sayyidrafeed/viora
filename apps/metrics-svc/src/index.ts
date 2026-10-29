import { createApp, loadEnv, portEnv } from '@viora/service-kit'

const env = loadEnv('metrics-svc', { PORT: portEnv(13007) })
const app = createApp('metrics-svc')

export default { port: env.PORT, fetch: app.fetch }

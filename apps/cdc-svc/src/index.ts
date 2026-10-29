import { createApp, loadEnv, portEnv } from '@viora/service-kit'

const env = loadEnv('cdc-svc', { PORT: portEnv(13008) })
const app = createApp('cdc-svc')

export default { port: env.PORT, fetch: app.fetch }

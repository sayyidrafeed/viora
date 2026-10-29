import { createApp, loadEnv, portEnv } from '@viora/service-kit'

const env = loadEnv('social-svc', { PORT: portEnv(13005) })
const app = createApp('social-svc')

export default { port: env.PORT, fetch: app.fetch }

import { createApp, loadEnv, portEnv } from '@viora/service-kit'

const env = loadEnv('upload-svc', { PORT: portEnv(13002) })
const app = createApp('upload-svc')

export default { port: env.PORT, fetch: app.fetch }

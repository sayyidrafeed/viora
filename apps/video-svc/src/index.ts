import { createApp, loadEnv, portEnv } from '@viora/service-kit'

const env = loadEnv('video-svc', { PORT: portEnv(13004) })
const app = createApp('video-svc')

export default { port: env.PORT, fetch: app.fetch }

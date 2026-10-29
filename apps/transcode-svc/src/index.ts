import { createApp, loadEnv, portEnv } from '@viora/service-kit'

const env = loadEnv('transcode-svc', { PORT: portEnv(13003) })
const app = createApp('transcode-svc')

export default { port: env.PORT, fetch: app.fetch }

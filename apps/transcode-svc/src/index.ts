import { createApp } from '@viora/service-kit'

const app = createApp('transcode-svc')

export default { port: Number(process.env.PORT ?? 13003), fetch: app.fetch }

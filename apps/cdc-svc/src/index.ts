import { createApp } from '@viora/service-kit'

const app = createApp('cdc-svc')

export default { port: Number(process.env.PORT ?? 13008), fetch: app.fetch }

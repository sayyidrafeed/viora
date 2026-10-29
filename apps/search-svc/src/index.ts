import { createApp } from '@viora/service-kit'

const app = createApp('search-svc')

export default { port: Number(process.env.PORT ?? 13009), fetch: app.fetch }

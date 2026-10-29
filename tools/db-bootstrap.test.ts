// Isolasi data antar-service di Postgres (§5): setiap role hanya bisa menyentuh schema miliknya. Butuh `bun run dev:infra`.
import { afterAll, beforeAll, expect, test } from 'bun:test'
import { SQL } from 'bun'
import { bootstrapDatabase } from './db-bootstrap.ts'

const adminUrl = process.env.DATABASE_ADMIN_URL ?? 'postgres://viora:viora-dev@127.0.0.1:15432/viora'
const dbName = `bootstrap_test_${Date.now().toString(36)}`
const urlFor = (user: string, password: string) =>
  Object.assign(new URL(adminUrl), { username: user, password, pathname: `/${dbName}` }).toString()
const admin = new SQL(adminUrl)
let identity: SQL
let video: SQL

beforeAll(async () => {
  await admin.unsafe(`create database ${dbName}`)
  const dbAdmin = new SQL(urlFor(new URL(adminUrl).username, new URL(adminUrl).password))
  await bootstrapDatabase(dbAdmin, dbName)
  await bootstrapDatabase(dbAdmin, dbName)
  await dbAdmin.close()
  identity = new SQL(urlFor('identity_svc', 'identity-svc-dev'))
  video = new SQL(urlFor('video_svc', 'video-svc-dev'))
})

afterAll(async () => {
  await identity.close()
  await video.close()
  await admin.unsafe(`drop database ${dbName} with (force)`)
  await admin.close()
})

test('role service membuat dan membaca tabel di schema miliknya, dengan search_path ke schema itu', async () => {
  await identity.unsafe('create table probe (id int primary key)')
  await identity.unsafe('insert into probe values (1)')
  const [row] = await identity.unsafe('select count(*)::int as n from identity.probe')
  expect(row.n).toBe(1)
})

test('role service tidak bisa membaca atau menulis schema service lain', async () => {
  await video.unsafe('create table video.secret (id int)')
  await expect(identity.unsafe('select * from video.secret')).rejects.toThrow(/permission denied/)
  await expect(identity.unsafe('create table video.intrusion (id int)')).rejects.toThrow(/permission denied/)
})

test('role service tidak bisa membuat objek di schema public', async () => {
  await expect(identity.unsafe('create table public.leak (id int)')).rejects.toThrow(/permission denied/)
})

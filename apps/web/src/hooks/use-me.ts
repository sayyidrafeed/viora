import { useQuery } from '@tanstack/react-query'
import { getV1MeOptions } from '@viora/api-client/query'

export const useMe = () => useQuery(getV1MeOptions())

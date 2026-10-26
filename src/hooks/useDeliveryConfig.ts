'use client'

import { useCallback, useEffect, useState } from 'react'
import { subscribe } from '@/lib/offline/events'
import { defaultConfig, getConfig, setConfig } from '@/lib/delivery/store'
import type { DeliveryConfig } from '@/lib/delivery/types'

export function useDeliveryConfig() {
  const [config, setLocal] = useState<DeliveryConfig>(defaultConfig)
  const load = useCallback(() => void getConfig().then(setLocal).catch(() => undefined), [])
  useEffect(() => {
    load()
    return subscribe(load)
  }, [load])
  const update = useCallback(async (patch: Partial<DeliveryConfig>) => setLocal(await setConfig(patch)), [])
  return { config, update }
}

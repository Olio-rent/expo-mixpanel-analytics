import { Platform, Dimensions } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import Constants from 'expo-constants'
import Device from 'expo-device'
import { Buffer } from 'buffer'

const DEFAULT_MIXPANEL_API_URL = 'https://api.mixpanel.com'
const DEFAULT_STORAGE_KEY = 'mixpanel:super:props'

type Props = Record<string, unknown>

export interface ExpoMixpanelAnalyticsConfig {
  clientId?: string
  storageKey?: string
  apiUrl?: string
}

export interface Event {
  name: string
  sent: boolean
  props?: Props
}

export class ExpoMixpanelAnalytics {
  ready = false
  storageKey: string
  apiUrl: string
  userId?: string
  clientId?: string
  platform?: string
  model?: string
  queue: Event[] = []
  superProps: Props = {}
  constants: Props = {
    app_build_number: Constants.manifest?.revisionId,
    app_id: Constants.manifest?.slug,
    app_name: Constants.manifest?.name,
    app_version_string: Constants.manifest?.version,
    device_name: Constants.deviceName,
    expo_app_ownership: Constants.appOwnership || undefined,
    os_version: Platform.Version,
  }

  constructor (
    public token: string,
    config?: ExpoMixpanelAnalyticsConfig,
  ) {
    this.storageKey = config?.storageKey ?? DEFAULT_STORAGE_KEY
    this.apiUrl = config?.apiUrl ?? DEFAULT_MIXPANEL_API_URL
    this.clientId = config?.clientId
  }

  async init () {
    const userAgent = await Constants.getWebViewUserAgentAsync()

    const { width, height } = Dimensions.get('window')

    Object.assign(this.constants, {
      screen_height: height,
      screen_size: `${width}x${height}`,
      screen_width: width,
      user_agent: userAgent,
    })

    if (Platform.OS === 'ios' && Constants.platform?.ios) {
      this.platform = Device.modelId ?? undefined
      this.model = Device.modelName ?? undefined
    } else {
      this.platform = 'android'
    }

    try {
      const result = await AsyncStorage.getItem(this.storageKey)
      this.superProps = JSON.parse(result ?? '{}')
      this.ready = true
      this._flush()
    } catch {}
  }

  async register (props: Props) {
    this.superProps = props
    try {
      await AsyncStorage.setItem(this.storageKey, JSON.stringify(props))
    } catch {}
  }

  track (name: string, props?: Props) {
    this.queue.push({
      name,
      props,
      sent: false
    })
    this._flush()
  }

  identify (userId?: string) {
    this.userId = userId
  }

  async reset () {
    this.identify(this.clientId)
    try {
      await AsyncStorage.setItem(this.storageKey, JSON.stringify({}))
    } catch {}
  }

  people_set (props: unknown) {
    this._people('set', props)
  }

  people_set_once (props: unknown) {
    this._people('set_once', props)
  }

  people_unset (props: unknown) {
    this._people('unset', props)
  }

  people_increment (props: unknown) {
    this._people('add', props)
  }

  people_append (props: unknown) {
    this._people('append', props)
  }

  people_union (props: unknown) {
    this._people('union', props)
  }

  people_delete_user () {
    this._people('delete', '')
  }

  // ===========================================================================================

  private _flush () {
    if (this.ready) {
      while (this.queue.length) {
        const event = this.queue.pop()!
        void this._pushEvent(event).then(() => event.sent = true)
      }
    }
  }

  private _people (operation: string, props: unknown) {
    if (this.userId) {
      const data = {
        $token: this.token,
        $distinct_id: this.userId,
        [`$${operation}`]: props
      }

      void this._push(data)
    }
  }

  private async _pushEvent (event: Event) {
    const data = {
      event: event.name,
      properties: {
        ...this.constants,
        ...event.props,
        ...this.superProps,
        distinct_id: this.userId,
        token: this.token,
        client_id: this.clientId,
        platform: this.platform,
        model: this.model,
      }
    }

    return this._push(data)
  }

  private async _push (data: unknown) {
    const base64Data = new Buffer(JSON.stringify(data)).toString('base64')
    return fetch(`${this.apiUrl}/engage/?data=${base64Data}`)
  }
}

export default ExpoMixpanelAnalytics

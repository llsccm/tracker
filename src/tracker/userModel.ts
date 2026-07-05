export interface UserData {
  t: number
  v: boolean
  g: unknown
  userID: number
  nickname: string
  [key: string]: unknown
}

export type UserModel = UserData

interface UserModelChange {
  user: UserModel
  property: PropertyKey
  value: unknown
  oldValue: unknown
}

interface UserModelOptions {
  onChange?: (change: UserModelChange) => void
}

export const DEFAULT_USER_DATA: UserData = {
  t: 0,
  v: false,
  g: null,
  userID: 0,
  nickname: ''
}

export function createUserModel(
  initialData: Partial<UserData> = {},
  { onChange = () => {} }: UserModelOptions = {}
): UserModel {
  const sourceUser: UserModel = {
    ...DEFAULT_USER_DATA,
    ...initialData
  }

  return new Proxy(sourceUser, {
    set(target, property, value, receiver) {
      const oldValue = target[property as keyof UserModel]
      const success = Reflect.set(target, property, value, receiver)

      if (success) {
        onChange({
          user: receiver as UserModel,
          property,
          value,
          oldValue
        })
      }

      return success
    }
  })
}

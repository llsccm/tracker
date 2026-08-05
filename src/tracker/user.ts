export interface UserData {
  userID: number
  nickname: string
  [key: string]: unknown
}

export const DEFAULT_USER_DATA: UserData = {
  userID: 0,
  nickname: ''
}

export function createUserModel(initialData: Partial<UserData> = {}): UserData {
  return {
    ...DEFAULT_USER_DATA,
    ...initialData
  }
}

export const user = createUserModel()

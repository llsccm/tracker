import { updateUserDom } from './runtime/browserUserBinding'
import { createUserModel } from './userModel'

const user = createUserModel(
  {},
  {
    onChange({ user: currentUser, property, value }) {
      updateUserDom(currentUser, property, value)
    }
  }
)

export { user }

export default class ConfigBase {
  configName = ''
  FileName = ''

  constructor(configName) {
    this.configName = configName
    this.longToShortObj = {}
    this.shortToLongObj = {}
  }

  parse(data) {
    if (!data) {
      console.error('配置解析出错：' + this.configName)
    }

    return data
  }

  initAbbreviation(data) {
    this.abbreviationField = data

    if (this.abbreviationField) {
      for (let i = 0; i < this.abbreviationField.length; i++) {
        const obj = this.abbreviationField[i]
        this.longToShortObj[obj.Long] = obj.Short
        this.shortToLongObj[obj.Short] = obj.Long
      }
    }
  }

  ClearData() {}
}

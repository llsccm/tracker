export default class RoguelikeDifficultyVo {
  /** 难度id */
  difID = 0
  /** 难度类型 1:普通 2:中等 */
  bdif = 0
  /** 难度等级 难度1 ~ 难度5 */
  sdif = 0
  bdesc = ''
  preID = 0
  bdifname = ''
  sdifname = ''
  diflv = 0
  seasonID = 0

  get DifID() {
    return this.difID || 0
  }

  get Bdif() {
    return this.bdif || 0
  }

  get Sdif() {
    return this.sdif || 0
  }

  get BdescList() {
    return this.bdesc ? this.bdesc.split(',') : []
  }

  get PreID() {
    return this.preID || 0
  }

  get Bdifname() {
    return this.bdifname || ''
  }

  get Sdifname() {
    return this.sdifname || ''
  }

  get Diflv() {
    return this.diflv || 0
  }

  get SeasonID() {
    return this.seasonID || 0
  }
}

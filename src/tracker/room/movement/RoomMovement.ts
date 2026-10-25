import {
  getMoveZone,
  getMovePosition,
  getMoveSubZone,
  getPopupSpaceID,
  getMoveSeat,
  getMoveMarkSpellID
} from '@/tracker/helper/moveEndpoint'
import type { Room } from '@/tracker/Room'
import { RoomMovementCandidates } from './candidates'
import { RoomMovementHiddenMarks } from './hiddenMarks'
import { RoomMovementSources } from './sources'
import { RoomMovementKnownSources } from './knownSources'
import { RoomMovementKnownPlacement } from './knownPlacement'
import { createMoveContext } from './context'
import { RoomMovementUnknownPlacement } from './unknownPlacement'
import type { MoveTargetZone, RoomMoveContext, RoomMovementOptions } from './types'
import type { CardID, RoomMoveRequest } from '@/tracker/types'
import { legacyMoveRequest } from './legacyMoveRequest'

/**
 * Room 的移动阶段实现模块，组合来源、候选、暗置标记与已知牌阶段，不持有独立推断状态。
 * 已知牌入口只编排来源解析/确认和准备/逐牌处理/落区收尾，具体策略由独立阶段组件实现。
 * 通用细分行为直接访问只读组件，共享查询直接从 sourceQueries 导入。
 */
export class RoomMovement {
  /** 来源取牌、占位置换与观测手牌差量；构造后不替换本局组件。 */
  readonly sources: RoomMovementSources
  /** 随机手牌与公共区候选传播，和来源组件共享同一个 Room。 */
  readonly candidates: RoomMovementCandidates
  /** 暗置标记、木牛空间与占位账本；身份物化直接调用其成员维护入口。 */
  readonly hiddenMarks: RoomMovementHiddenMarks
  private readonly knownSources: RoomMovementKnownSources
  private readonly knownPlacement: RoomMovementKnownPlacement
  private readonly unknownPlacement: RoomMovementUnknownPlacement

  constructor(private readonly room: Room) {
    this.hiddenMarks = new RoomMovementHiddenMarks(room)
    this.sources = new RoomMovementSources(room, this.hiddenMarks)
    this.candidates = new RoomMovementCandidates(room)
    this.knownSources = new RoomMovementKnownSources(room, this.sources)
    this.knownPlacement = new RoomMovementKnownPlacement(room, this.sources, this.hiddenMarks)
    this.unknownPlacement = new RoomMovementUnknownPlacement(room, this.sources, this.candidates)
  }

  /** 构造只读输入快照；移动前事实在 hand-total delta 写入前捕获。 */
  createMoveContext(cardIDs: readonly CardID[], request: RoomMoveRequest): RoomMoveContext
  createMoveContext(
    cardIDs: readonly CardID[],
    toZone: MoveTargetZone,
    opt?: RoomMovementOptions
  ): RoomMoveContext
  createMoveContext(
    cardIDs: readonly CardID[],
    request: RoomMoveRequest | MoveTargetZone,
    opt: RoomMovementOptions = {}
  ): RoomMoveContext {
    return createMoveContext(
      this.room,
      cardIDs,
      typeof request === 'string' ? legacyMoveRequest(request, opt) : request
    )
  }

  /** 按来源解析整批已知牌，再统一恢复追踪与确认身份。 */
  resolveKnownMoveCards(context: RoomMoveContext): void {
    const resolution = this.knownSources.resolve(context)
    this.knownSources.confirm(context, resolution)
  }

  /**
   * 在真正搬牌前传播候选信息。
   * 处理玩家间随机获得手牌、手牌回牌堆、牌堆候选进入手牌三类不确定性语义。
   */
  applyMoveCandidatePropagation(context: RoomMoveContext): void {
    const {
      handMoveCount,
      sourceEvent,
      sourceHandSeat,
      targetHandSeat,
      unknownCount,
      forceRandomHandTransferCandidates
    } = context
    const fromZone = getMoveZone(context.from)
    const fromPosition = getMovePosition(context.from)
    const position = getMovePosition(context.to)
    const subZone = getMoveSubZone(context.to)
    const toZone = getMoveZone(context.to)

    // 木牛流马内部牌只随 mark700 协议迁移，不随装备本体移动。
    if (this.hiddenMarks.handleMuniuMarkMove(context)) return

    // 暗置标记区候选会接管默认暗牌移动，避免明牌身份被未知占位吞掉。
    if (this.hiddenMarks.handleHiddenMarkMove(context)) return

    // 标记区可见牌多于协议暗牌张数时，挑一张会固化身份，改为标记/手牌双边候选。
    if (
      this.candidates.markStoredToHandCandidates({
        fromPopupSpaceID: context.knownIDs.length === 0 ? getPopupSpaceID(context.from) : undefined,
        fromSeat:
          getMoveSubZone(context.from) === 'mark' && context.knownIDs.length === 0
            ? getMoveSeat(context.from)
            : null,
        fromSpellID: getMoveMarkSpellID(context.from),
        toSeat: context.targetHandSeat,
        count: context.unknownCount,
        gainSpellID: context.gainSpellID,
        sourceEvent: context.sourceEvent
      })
    ) {
      context.skipUnknownMovement = true
    }

    if (
      forceRandomHandTransferCandidates ||
      this.candidates.shouldPropagateRandomHandTransferCandidates({
        sourceSeat: sourceHandSeat,
        targetSeat: targetHandSeat,
        count: handMoveCount,
        unknownCount,
        sourceHandTotalObserved: context.sourceHandTotalObserved,
        sourceHandTotalBefore: context.sourceHandTotalBefore,
        sourceHandUnknownCount: context.sourceHandUnknownCount,
        sourceEvent
      })
    ) {
      // 随机获得来源手牌时：若来源仍有明牌，扩展为“来源/目标都可能持有”；
      // 来源全暗则走下方默认暗牌移动，不必做无展示价值的 N 选 K。
      const propagatedCards = this.candidates.markRandomHandTransferCandidates({
        fromSeat: sourceHandSeat,
        targetSeat: targetHandSeat,
        count: handMoveCount,
        sourceTotalBefore: context.sourceHandTotalObserved
          ? context.sourceHandTotalBefore
          : undefined,
        sourceHandTotalObserved: context.sourceHandTotalObserved,
        sourceUnknownCount: context.sourceHandTotalObserved
          ? context.sourceHandUnknownCount
          : undefined,
        sourceEvent,
        force: forceRandomHandTransferCandidates
      })

      // 完整候选覆盖已经表达了这次 K 张转移；此时不能再确定性挑选暗实体搬到目标。
      // 返回空数组表示候选建模失败，仍允许默认未知移动路径执行保守回退。
      context.skipUnknownMovement = propagatedCards.length > 0
      const gainSpellID = context.gainSpellID
      if (gainSpellID !== undefined && targetHandSeat !== null) {
        propagatedCards.forEach((card) => card.recordHandGain(targetHandSeat, gainSpellID))
      }
    }

    if (
      this.candidates.shouldMarkRandomHandToPublicCandidates(
        sourceHandSeat,
        targetHandSeat,
        toZone,
        unknownCount
      )
    ) {
      // 身份未知的手牌回到公共区时，保留牌堆顶/底候选，后续被摸走时还能继续传播。
      this.candidates.markRandomHandToPublicCandidates({
        fromSeat: sourceHandSeat,
        toZone,
        position,
        unknownCount,
        candidateSource: context.publicCandidateSource
      })
    }

    // 若来源公共区已有候选牌，摸入手牌时把公共候选转化为目标玩家手牌候选。
    const publicHandCandidates = this.candidates.propagatePublicCandidatesToHand({
      fromZone,
      fromPosition,
      toZone,
      targetSeat: targetHandSeat,
      subZone,
      count: handMoveCount,
      sourceEvent
    })
    const gainSpellID = context.gainSpellID
    if (gainSpellID !== undefined && targetHandSeat !== null) {
      publicHandCandidates.forEach((card) => card.recordHandGain(targetHandSeat, gainSpellID))
    }
  }

  /**
   * 移动暗牌占位。
   * 暗牌进入玩家区时绑定候选席位并创建局部分组；进入公共区时维护 Zone 顺序和公共候选。
   */
  moveUnknownCardsForContext(context: RoomMoveContext): void {
    this.unknownPlacement.move(context)
  }

  /** 已知牌落区流水线：批次准备、逐牌来源校正、目标落区与旧公共槽回补。 */
  moveKnownCardsForContext(context: RoomMoveContext): void {
    const placement = this.knownPlacement.prepare(context)
    if (!placement) return
    this.knownPlacement.moveEachCard(context, placement)
    this.knownPlacement.finishMove(context, placement)
  }

  /**
   * 为移入公共区的一组牌补充组合约束。
   * 公共区自身不表达 owner，这里只保留组合关系，供后续回到玩家区时继续收敛。
   */
  createPublicMoveConstraintGroup(context: RoomMoveContext): void {
    const { combinationID, publicMovedCards, sourceEvent } = context
    const toZone = getMoveZone(context.to)
    if (toZone === 'player' || !combinationID || publicMovedCards.length === 0) return

    this.room.createConstraintGroup({
      id: combinationID,
      cards: publicMovedCards,
      sourceEvent: sourceEvent ?? { type: 'moveCards:publicGroup' }
    })
  }
}

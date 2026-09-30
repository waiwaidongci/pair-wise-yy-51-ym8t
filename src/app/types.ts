export type RiskLevel = '高' | '中' | '低'

export type ApprovalRole = '安全' | '运营' | '应急'

export type SnapshotStatus = '审批中' | '已锁定' | '已失效'

export type SignatureStatus = '已签署' | '已失效'

export interface RiskSegment {
  id: string
  name: string
  from: string
  to: string
  km: string
  speed: string
  risks: string[]
  level: RiskLevel
  status: '待复核' | '已确认' | '需绕行'
  coordinates: [number, number][]
}

export interface RoutePackage {
  id: string
  cargo: string
  hazardClass: string
  trainCode: string
  origin: string
  destination: string
  tonnage: number
  wagonCount: number
  permit: string
  permission: '有效' | '缺失' | '待补充'
  score: number
  updatedAt: string
  segments: RiskSegment[]
}

export interface ReviewComment {
  id: string
  segmentId: string
  role: string
  author: string
  content: string
  status: '待确认' | '已接受' | '已退回'
}

/** 会签签署记录：锚定到具体快照版本 */
export interface ApprovalSignature {
  role: ApprovalRole
  author: string
  signedAt: string
  status: SignatureStatus
  /** 签署时所依据的快照版本 */
  snapshotVersion: number
}

/** 审批快照：送审时冻结风险区段与许可 */
export interface ApprovalSnapshot {
  id: string
  routeId: string
  /** 冻结时的草案版本 */
  version: number
  status: SnapshotStatus
  frozenAt: string
  frozenBy: string
  /** 冻结的风险区段（只读） */
  segments: RiskSegment[]
  /** 冻结的许可状态与编号 */
  permission: RoutePackage['permission']
  permit: string
  score: number
  signatures: ApprovalSignature[]
  /** 锁定幂等请求编号 */
  lockRequestId?: string
  lockedAt?: string
}

export type AuditType = '送审' | '签署' | '失效' | '锁定' | '冲突'

export interface AuditEntry {
  id: string
  routeId: string
  snapshotId?: string
  requestId?: string
  at: string
  type: AuditType
  description: string
}

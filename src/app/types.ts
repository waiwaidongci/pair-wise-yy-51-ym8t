export type RiskLevel = '高' | '中' | '低'

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

export type ApprovalRole = '安全' | '运营' | '应急'

export interface SnapshotSignature {
  role: ApprovalRole
  signer: string
  signedAt: string
  revision: number
  status: '有效' | '已失效'
}

export interface FrozenSegment {
  id: string
  name: string
  level: RiskLevel
  status: RiskSegment['status']
  speed: string
}

/** 审批快照：送审时冻结运输单的风险区段与许可，三方会签都锚定同一份快照 */
export interface ApprovalSnapshot {
  id: string
  routeId: string
  revision: number
  status: '会签中' | '已锁定' | '已失效'
  frozenAt: string
  frozenBy: string
  frozenPermission: RoutePackage['permission']
  frozenPermit: string
  frozenScore: number
  frozenSegments: FrozenSegment[]
  signatures: SnapshotSignature[]
  /** 最近一次改动导致会签失效时，被作废签署的受影响角色 */
  affectedRoles: ApprovalRole[]
  /** 锁定请求的幂等编号，重试必须沿用 */
  lockRequestId: string
  lockedAt: string
}

export interface AuditEntry {
  id: string
  at: string
  actor: string
  action: string
  detail: string
  snapshotId: string
}

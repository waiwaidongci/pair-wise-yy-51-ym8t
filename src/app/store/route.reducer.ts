import { createReducer, on } from '@ngrx/store'
import type { ApprovalRole, ApprovalSnapshot, AuditEntry, ReviewComment, RoutePackage, SnapshotSignature } from '../types'
import * as RouteActions from './route.actions'

export interface RouteState {
  routes: RoutePackage[]
  selectedRouteId: string
  selectedSegmentId: string
  comments: ReviewComment[]
  snapshots: ApprovalSnapshot[]
  audit: AuditEntry[]
  /** 锁定请求编号登记簿：pending / done / failed，用于幂等去重 */
  lockRequests: Record<string, 'pending' | 'done' | 'failed'>
  /** 旧快照提交、重复会签等冲突提示 */
  lastConflict: string
  lockError: string
  loading: boolean
  error: string
  version: number
}

const APPROVAL_ROLES: ApprovalRole[] = ['安全', '运营', '应急']

const now = () => new Date().toLocaleTimeString('zh-CN', { hour12: false })

let auditSeq = 0
const auditEntry = (actor: string, action: string, detail: string, snapshotId = ''): AuditEntry => ({
  id: `AU-${Date.now().toString(36)}-${++auditSeq}`, at: now(), actor, action, detail, snapshotId,
})

const latestSnapshot = (snapshots: ApprovalSnapshot[], routeId: string): ApprovalSnapshot | undefined =>
  snapshots.filter((snapshot) => snapshot.routeId === routeId).sort((a, b) => b.revision - a.revision)[0]

/** 风险/许可变更后：进行中的会签立即失效，作废已签署名并标出受影响角色 */
const invalidateActive = (state: RouteState, routeId: string, reason: string): Pick<RouteState, 'snapshots' | 'audit'> => {
  const active = latestSnapshot(state.snapshots, routeId)
  if (!active || active.status !== '会签中') return { snapshots: state.snapshots, audit: state.audit }
  const affectedRoles = active.signatures.filter((signature) => signature.status === '有效').map((signature) => signature.role)
  const invalidated: ApprovalSnapshot = {
    ...active,
    status: '已失效',
    affectedRoles,
    signatures: active.signatures.map((signature) => signature.status === '有效' ? { ...signature, status: '已失效' as const } : signature),
  }
  const detail = `${reason}，快照 ${active.id}（第 ${active.revision} 版）会签失效` +
    (affectedRoles.length ? `，受影响角色：${affectedRoles.join('、')}（已签署作废，需重新会签）` : '，尚无签署受影响')
  return {
    snapshots: state.snapshots.map((snapshot) => snapshot.id === active.id ? invalidated : snapshot),
    audit: [auditEntry('系统', '会签失效', detail, active.id), ...state.audit],
  }
}

export const initialState: RouteState = {
  routes: [], selectedRouteId: '', selectedSegmentId: '', loading: false, error: '', version: 6,
  comments: [
    { id: 'RV-31', segmentId: 'S-203', role: '安全', author: '韩洁', content: '水源地保护段限速 45 km/h，并要求随车配置吸附围油栏。', status: '待确认' },
    { id: 'RV-32', segmentId: 'S-207', role: '应急', author: '罗晋', content: '长隧道出口需增加 15 分钟现场监护窗口，接受后方可放行。', status: '已接受' },
  ],
  snapshots: [
    {
      id: 'AP-HG-260929-018-01', routeId: 'HG-260929-018', revision: 1, status: '会签中',
      frozenAt: '今天 16:50', frozenBy: '调度所 王工',
      frozenPermission: '待补充', frozenPermit: '甘危运〔2026〕0831 号', frozenScore: 78,
      frozenSegments: [
        { id: 'S-201', name: '兰州枢纽东联络线', level: '中', status: '已确认', speed: '限速 60' },
        { id: 'S-203', name: '西峡水源保护区段', level: '高', status: '需绕行', speed: '限速 45' },
        { id: 'S-207', name: '郑州北至商丘区段', level: '高', status: '需绕行', speed: '限速 80' },
        { id: 'S-211', name: '徐州东至南京东', level: '低', status: '已确认', speed: '限速 80' },
      ],
      signatures: [
        { role: '安全', signer: '韩洁', signedAt: '今天 16:55', revision: 1, status: '有效' },
      ],
      affectedRoles: [], lockRequestId: '', lockedAt: '',
    },
  ],
  audit: [
    { id: 'AU-SEED-3', at: '今天 16:55', actor: '韩洁', action: '安全会签', detail: '签署快照 AP-HG-260929-018-01（第 1 版，冻结许可：待补充）', snapshotId: 'AP-HG-260929-018-01' },
    { id: 'AU-SEED-2', at: '今天 16:50', actor: '调度所 王工', action: '提交送审', detail: '冻结 HG-260929-018 风险区段与许可，生成快照 AP-HG-260929-018-01（第 1 版）', snapshotId: 'AP-HG-260929-018-01' },
    { id: 'AU-SEED-1', at: '今天 15:50', actor: '规则引擎', action: '生成替代路径', detail: 'R-ALT-02 风险分由 78 降至 71', snapshotId: '' },
  ],
  lockRequests: {}, lastConflict: '', lockError: '',
}

export const routeReducer = createReducer(
  initialState,
  on(RouteActions.loadRoutes, (state) => ({ ...state, loading: true, error: '' })),
  on(RouteActions.loadRoutesSuccess, (state, { routes }) => ({ ...state, loading: false, routes, selectedRouteId: state.selectedRouteId || routes[0]?.id || '', selectedSegmentId: state.selectedSegmentId || routes[0]?.segments[0]?.id || '' })),
  on(RouteActions.loadRoutesFailure, (state, { error }) => ({ ...state, loading: false, error })),
  on(RouteActions.selectRoute, (state, { id }) => ({ ...state, selectedRouteId: id, selectedSegmentId: state.routes.find((route) => route.id === id)?.segments[0]?.id ?? '' })),
  on(RouteActions.selectSegment, (state, { id }) => ({ ...state, selectedSegmentId: id })),
  on(RouteActions.updateSegmentLevel, (state, { id, level }) => {
    const route = state.routes.find((item) => item.segments.some((segment) => segment.id === id))
    if (!route) return state
    if (latestSnapshot(state.snapshots, route.id)?.status === '已锁定') {
      return { ...state, lastConflict: `运输单 ${route.id} 基线已锁定，区段风险只读` }
    }
    const routes = state.routes.map((item) => ({ ...item, segments: item.segments.map((segment) => segment.id === id ? { ...segment, level, status: level === '高' ? '需绕行' as const : '待复核' as const } : segment) }))
    const { snapshots, audit } = invalidateActive(state, route.id, `区段 ${id} 风险等级调整为「${level}」`)
    return { ...state, routes, snapshots, audit, version: state.version + 1 }
  }),
  on(RouteActions.updatePermission, (state, { routeId, permission }) => {
    const route = state.routes.find((item) => item.id === routeId)
    if (!route) return state
    if (latestSnapshot(state.snapshots, routeId)?.status === '已锁定') {
      return { ...state, lastConflict: `运输单 ${routeId} 基线已锁定，许可状态只读` }
    }
    const routes = state.routes.map((item) => item.id === routeId ? { ...item, permission } : item)
    const { snapshots, audit } = invalidateActive(state, routeId, `许可状态变更为「${permission}」`)
    return { ...state, routes, snapshots, audit, version: state.version + 1 }
  }),
  on(RouteActions.addComment, (state, { comment }) => ({ ...state, comments: [comment, ...state.comments] })),
  on(RouteActions.resolveComment, (state, { id, status }) => ({ ...state, comments: state.comments.map((comment) => comment.id === id ? { ...comment, status } : comment) })),
  on(RouteActions.createAlternative, (state) => {
    if (latestSnapshot(state.snapshots, state.selectedRouteId)?.status === '已锁定') {
      return { ...state, lastConflict: `运输单 ${state.selectedRouteId} 基线已锁定，不能生成替代方案` }
    }
    const routes = state.routes.map((route) => route.id === state.selectedRouteId ? { ...route, id: `${route.id}-ALT`, score: Math.max(72, route.score - 2) } : route)
    const { snapshots, audit } = invalidateActive(state, state.selectedRouteId, '生成替代方案')
    return { ...state, routes, snapshots, audit, version: state.version + 1 }
  }),
  on(RouteActions.submitForApproval, (state, { routeId, actor }) => {
    const route = state.routes.find((item) => item.id === routeId)
    if (!route) return state
    const latest = latestSnapshot(state.snapshots, routeId)
    if (latest?.status === '会签中') return { ...state, lastConflict: `快照 ${latest.id} 会签尚未完成，不能重复送审` }
    if (latest?.status === '已锁定') return { ...state, lastConflict: `运输单 ${routeId} 基线已锁定，不能重复送审` }
    const revision = (latest?.revision ?? 0) + 1
    const snapshot: ApprovalSnapshot = {
      id: `AP-${routeId}-${String(revision).padStart(2, '0')}`,
      routeId, revision, status: '会签中', frozenAt: now(), frozenBy: actor,
      frozenPermission: route.permission, frozenPermit: route.permit, frozenScore: route.score,
      frozenSegments: route.segments.map((segment) => ({ id: segment.id, name: segment.name, level: segment.level, status: segment.status, speed: segment.speed })),
      signatures: [], affectedRoles: [], lockRequestId: '', lockedAt: '',
    }
    return {
      ...state, lastConflict: '', lockError: '',
      snapshots: [snapshot, ...state.snapshots],
      audit: [auditEntry(actor, '提交送审', `冻结 ${routeId} 风险区段与许可，生成快照 ${snapshot.id}（第 ${revision} 版）`, snapshot.id), ...state.audit],
    }
  }),
  on(RouteActions.signSnapshot, (state, { snapshotId, revision, role, signer }) => {
    const snapshot = state.snapshots.find((item) => item.id === snapshotId)
    if (!snapshot) return { ...state, lastConflict: `快照 ${snapshotId} 不存在` }
    if (snapshot.status === '已失效') return { ...state, lastConflict: `快照 ${snapshotId} 已因风险/许可变更失效，请重新送审后再签署` }
    if (snapshot.status === '已锁定') return { ...state, lastConflict: `快照 ${snapshotId} 已锁定，不能再签署` }
    if (revision !== snapshot.revision) {
      return { ...state, lastConflict: `快照版本冲突：你提交的是第 ${revision} 版，当前为第 ${snapshot.revision} 版，请按当前快照重新签署` }
    }
    if (snapshot.signatures.some((signature) => signature.role === role && signature.status === '有效')) {
      return { ...state, lastConflict: `${role}角色已签署本版快照，不能重复会签` }
    }
    const signature: SnapshotSignature = { role, signer, signedAt: now(), revision, status: '有效' }
    return {
      ...state, lastConflict: '',
      snapshots: state.snapshots.map((item) => item.id === snapshotId ? { ...item, signatures: [...item.signatures, signature] } : item),
      audit: [auditEntry(signer, `${role}会签`, `签署快照 ${snapshotId}（第 ${revision} 版，冻结许可：${snapshot.frozenPermission}）`, snapshotId), ...state.audit],
    }
  }),
  on(RouteActions.lockSnapshot, (state, { snapshotId, requestId }) => {
    const snapshot = state.snapshots.find((item) => item.id === snapshotId)
    if (!snapshot) return { ...state, lastConflict: `快照 ${snapshotId} 不存在` }
    // 幂等：同一请求编号只处理一次，重试/重复点击不产生第二条审批
    if (state.lockRequests[requestId] === 'done' || state.lockRequests[requestId] === 'pending') return state
    if (snapshot.status !== '会签中') return { ...state, lastConflict: `快照 ${snapshotId} 当前为「${snapshot.status}」，不能锁定` }
    const signed = new Set(snapshot.signatures.filter((signature) => signature.status === '有效' && signature.revision === snapshot.revision).map((signature) => signature.role))
    const missing = APPROVAL_ROLES.filter((role) => !signed.has(role))
    if (missing.length) return { ...state, lastConflict: `三方会签未齐（缺：${missing.join('、')}），不能锁定` }
    return {
      ...state, lastConflict: '', lockError: '',
      lockRequests: { ...state.lockRequests, [requestId]: 'pending' as const },
      snapshots: state.snapshots.map((item) => item.id === snapshotId ? { ...item, lockRequestId: requestId } : item),
    }
  }),
  on(RouteActions.lockSnapshotSuccess, (state, { snapshotId, requestId, actor }) => {
    const snapshot = state.snapshots.find((item) => item.id === snapshotId)
    if (!snapshot) return state
    // 防重：已锁定的快照不再写入第二条审计记录
    if (snapshot.status === '已锁定') return state
    const lockedAt = now()
    return {
      ...state, lockError: '',
      lockRequests: { ...state.lockRequests, [requestId]: 'done' as const },
      snapshots: state.snapshots.map((item) => item.id === snapshotId ? { ...item, status: '已锁定' as const, lockedAt, lockRequestId: requestId } : item),
      audit: [auditEntry(actor, '基线锁定', `三方会签完成，快照 ${snapshotId}（第 ${snapshot.revision} 版）锁定，风险与许可转入只读（请求编号 ${requestId}）`, snapshotId), ...state.audit],
    }
  }),
  on(RouteActions.lockSnapshotFailure, (state, { requestId, error }) => ({
    // 锁定失败：快照与已签会签原样保留，仅登记失败，等待同编号重试
    ...state,
    lockRequests: { ...state.lockRequests, [requestId]: 'failed' as const },
    lockError: error,
  })),
  on(RouteActions.clearConflict, (state) => ({ ...state, lastConflict: '' })),
)

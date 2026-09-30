import { createReducer, on } from '@ngrx/store'
import type { ApprovalSnapshot, AuditEntry, ReviewComment, RoutePackage } from '../types'
import * as RouteActions from './route.actions'

export interface RouteState {
  routes: RoutePackage[]
  selectedRouteId: string
  selectedSegmentId: string
  comments: ReviewComment[]
  snapshots: ApprovalSnapshot[]
  auditEntries: AuditEntry[]
  loading: boolean
  error: string
  version: number
  // 会签与锁定 UI 态
  signError: string
  signConflict: boolean
  lockError: string
  locking: boolean
  lastLockRequestId: string
}

export const initialState: RouteState = {
  routes: [], selectedRouteId: '', selectedSegmentId: '', loading: false, error: '', version: 6,
  comments: [
    { id: 'RV-31', segmentId: 'S-203', role: '安全', author: '韩洁', content: '水源地保护段限速 45 km/h，并要求随车配置吸附围油栏。', status: '待确认' },
    { id: 'RV-32', segmentId: 'S-207', role: '应急', author: '罗晋', content: '长隧道出口需增加 15 分钟现场监护窗口，接受后方可放行。', status: '已接受' },
  ],
  snapshots: [],
  auditEntries: [],
  signError: '', signConflict: false, lockError: '', locking: false, lastLockRequestId: '',
}

/** 取出某运输单当前有效的审批中快照 */
export function findActiveSnapshot(state: RouteState, routeId: string): ApprovalSnapshot | undefined {
  return state.snapshots.find((snapshot) => snapshot.routeId === routeId && snapshot.status === '审批中')
}

/**
 * 令某运输单的审批中快照失效：
 * 快照置为已失效，已签署的会签置为已失效，并生成失效审计（标出受影响角色）。
 */
function invalidateActiveSnapshot(state: RouteState, routeId: string, reason: string): { snapshots: ApprovalSnapshot[]; auditEntries: AuditEntry[] } {
  const active = findActiveSnapshot(state, routeId)
  if (!active) return { snapshots: state.snapshots, auditEntries: state.auditEntries }
  const affectedRoles = active.signatures.filter((signature) => signature.status === '已签署').map((signature) => signature.role)
  const snapshots = state.snapshots.map((snapshot) => snapshot.id === active.id ? {
    ...snapshot,
    status: '已失效' as const,
    signatures: snapshot.signatures.map((signature) => signature.status === '已签署' ? { ...signature, status: '已失效' as const } : signature),
  } : snapshot)
  const audit: AuditEntry = {
    id: `AUD-${state.version + 1}-INV`,
    routeId,
    snapshotId: active.id,
    at: new Date().toISOString(),
    type: '失效',
    description: `${reason}，快照 ${active.id} 失效`,
  }
  return { snapshots, auditEntries: [audit, ...state.auditEntries] }
}

export const routeReducer = createReducer(
  initialState,
  on(RouteActions.loadRoutes, (state) => ({ ...state, loading: true, error: '' })),
  on(RouteActions.loadRoutesSuccess, (state, { routes }) => ({ ...state, loading: false, routes, selectedRouteId: state.selectedRouteId || routes[0]?.id || '', selectedSegmentId: state.selectedSegmentId || routes[0]?.segments[0]?.id || '' })),
  on(RouteActions.loadRoutesFailure, (state, { error }) => ({ ...state, loading: false, error })),
  on(RouteActions.selectRoute, (state, { id }) => ({ ...state, selectedRouteId: id, selectedSegmentId: state.routes.find((route) => route.id === id)?.segments[0]?.id ?? '' })),
  on(RouteActions.selectSegment, (state, { id }) => ({ ...state, selectedSegmentId: id })),

  // 区段风险变更：版本 +1，并令当前审批中快照失效（旧会签不再放行）
  on(RouteActions.updateSegmentLevel, (state, { id, level }) => {
    const routeId = state.routes.find((route) => route.segments.some((segment) => segment.id === id))?.id
    const routes = state.routes.map((route) => ({
      ...route,
      segments: route.segments.map((segment) => segment.id === id
        ? { ...segment, level, status: level === '高' ? '需绕行' as const : segment.status === '需绕行' ? '待复核' as const : segment.status }
        : segment),
    }))
    if (!routeId) return { ...state, routes }
    const { snapshots, auditEntries } = invalidateActiveSnapshot(state, routeId, `区段 ${id} 风险调整为${level}`)
    return { ...state, version: state.version + 1, routes, snapshots, auditEntries }
  }),

  on(RouteActions.addComment, (state, { comment }) => ({ ...state, comments: [comment, ...state.comments] })),
  on(RouteActions.resolveComment, (state, { id, status }) => ({ ...state, comments: state.comments.map((comment) => comment.id === id ? { ...comment, status } : comment) })),

  // 生成替代方案：运输单发生实质变更，同样令当前快照失效
  on(RouteActions.createAlternative, (state) => {
    const routeId = state.selectedRouteId
    const routes = state.routes.map((route) => route.id === routeId ? { ...route, id: `${route.id}-ALT`, score: Math.max(72, route.score - 2) } : route)
    const { snapshots, auditEntries } = invalidateActiveSnapshot(state, routeId, '生成替代方案，路径与风险重排')
    return { ...state, version: state.version + 1, routes, snapshots, auditEntries }
  }),

  // 送审冻结
  on(RouteActions.submitForReview, (state) => ({ ...state, error: '', signError: '', signConflict: false })),
  on(RouteActions.submitForReviewSuccess, (state, { snapshot, audit }) => ({
    ...state,
    snapshots: [snapshot, ...state.snapshots],
    auditEntries: [audit, ...state.auditEntries],
    error: '',
  })),
  on(RouteActions.submitForReviewFailure, (state, { error }) => ({ ...state, error })),

  // 会签
  on(RouteActions.signSnapshot, (state) => ({ ...state, signError: '', signConflict: false })),
  on(RouteActions.signSnapshotSuccess, (state, { snapshotId, signature, audit }) => ({
    ...state,
    snapshots: state.snapshots.map((snapshot) => snapshot.id === snapshotId
      ? { ...snapshot, signatures: snapshot.signatures.some((item) => item.role === signature.role) ? snapshot.signatures : [...snapshot.signatures, signature] }
      : snapshot),
    auditEntries: audit ? [audit, ...state.auditEntries] : state.auditEntries,
    signError: '', signConflict: false,
  })),
  on(RouteActions.signSnapshotFailure, (state, { error, conflict }) => ({ ...state, signError: error, signConflict: conflict })),

  // 锁定
  on(RouteActions.lockApproval, (state, { requestId }) => ({ ...state, locking: true, lockError: '', lastLockRequestId: requestId })),
  on(RouteActions.lockApprovalSuccess, (state, { snapshot, audit }) => ({
    ...state,
    locking: false,
    snapshots: state.snapshots.map((item) => item.id === snapshot.id ? { ...snapshot } : item),
    // 幂等：同一请求编号的锁定审计只保留一条
    auditEntries: state.auditEntries.some((item) => item.requestId === audit.requestId && item.type === '锁定')
      ? state.auditEntries
      : [audit, ...state.auditEntries],
    lockError: '',
  })),
  on(RouteActions.lockApprovalFailure, (state, { error, requestId }) => ({ ...state, locking: false, lockError: error, lastLockRequestId: requestId })),
)

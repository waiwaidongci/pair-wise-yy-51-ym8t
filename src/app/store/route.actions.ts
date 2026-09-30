import { createAction, props } from '@ngrx/store'
import type { ApprovalRole, ReviewComment, RiskLevel, RoutePackage } from '../types'

export const loadRoutes = createAction('[Route Workbench] Load Routes')
export const loadRoutesSuccess = createAction('[Route API] Load Routes Success', props<{ routes: RoutePackage[] }>())
export const loadRoutesFailure = createAction('[Route API] Load Routes Failure', props<{ error: string }>())
export const selectRoute = createAction('[Route Workbench] Select Route', props<{ id: string }>())
export const selectSegment = createAction('[Risk Map] Select Segment', props<{ id: string }>())
export const updateSegmentLevel = createAction('[Risk Map] Update Level', props<{ id: string; level: RiskLevel }>())
export const updatePermission = createAction('[Route Workbench] Update Permission', props<{ routeId: string; permission: RoutePackage['permission'] }>())
export const addComment = createAction('[Approval] Add Comment', props<{ comment: ReviewComment }>())
export const resolveComment = createAction('[Approval] Resolve Comment', props<{ id: string; status: ReviewComment['status'] }>())
export const createAlternative = createAction('[Risk Map] Create Alternative')
/** 送审：冻结当前风险区段与许可，生成新版审批快照 */
export const submitForApproval = createAction('[Approval] Submit For Approval', props<{ routeId: string; actor: string }>())
/** 会签：必须携带签署时看到的快照版本，旧版本提交由 reducer 判冲突 */
export const signSnapshot = createAction('[Approval] Sign Snapshot', props<{ snapshotId: string; revision: number; role: ApprovalRole; signer: string }>())
/** 锁定：requestId 为幂等编号，失败重试沿用同一编号 */
export const lockSnapshot = createAction('[Approval] Lock Snapshot', props<{ snapshotId: string; requestId: string; actor: string }>())
export const lockSnapshotSuccess = createAction('[Approval] Lock Snapshot Success', props<{ snapshotId: string; requestId: string; actor: string }>())
export const lockSnapshotFailure = createAction('[Approval] Lock Snapshot Failure', props<{ snapshotId: string; requestId: string; error: string }>())
export const clearConflict = createAction('[Approval] Clear Conflict')

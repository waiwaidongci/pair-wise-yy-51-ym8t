import { createAction, props } from '@ngrx/store'
import type { ApprovalRole, ApprovalSignature, ApprovalSnapshot, AuditEntry, ReviewComment, RiskLevel, RoutePackage } from '../types'

export const loadRoutes = createAction('[Route Workbench] Load Routes')
export const loadRoutesSuccess = createAction('[Route API] Load Routes Success', props<{ routes: RoutePackage[] }>())
export const loadRoutesFailure = createAction('[Route API] Load Routes Failure', props<{ error: string }>())
export const selectRoute = createAction('[Route Workbench] Select Route', props<{ id: string }>())
export const selectSegment = createAction('[Risk Map] Select Segment', props<{ id: string }>())
export const updateSegmentLevel = createAction('[Risk Map] Update Level', props<{ id: string; level: RiskLevel }>())
export const addComment = createAction('[Approval] Add Comment', props<{ comment: ReviewComment }>())
export const resolveComment = createAction('[Approval] Resolve Comment', props<{ id: string; status: ReviewComment['status'] }>())
export const createAlternative = createAction('[Risk Map] Create Alternative')

// 审批快照：送审冻结
export const submitForReview = createAction('[Approval] Submit For Review', props<{ routeId: string }>())
export const submitForReviewSuccess = createAction('[Approval API] Submit For Review Success', props<{ snapshot: ApprovalSnapshot; audit: AuditEntry }>())
export const submitForReviewFailure = createAction('[Approval API] Submit For Review Failure', props<{ error: string }>())

// 会签：按当前快照签署，旧快照报冲突
export const signSnapshot = createAction('[Approval] Sign Snapshot', props<{ snapshotId: string; role: ApprovalRole; author: string }>())
export const signSnapshotSuccess = createAction('[Approval API] Sign Snapshot Success', props<{ snapshotId: string; signature: ApprovalSignature; audit: AuditEntry | null }>())
export const signSnapshotFailure = createAction('[Approval API] Sign Snapshot Failure', props<{ error: string; conflict: boolean }>())

// 锁定：三方签完才锁定，按请求编号幂等重试
export const lockApproval = createAction('[Approval] Lock Approval', props<{ snapshotId: string; requestId: string }>())
export const lockApprovalSuccess = createAction('[Approval API] Lock Approval Success', props<{ snapshot: ApprovalSnapshot; audit: AuditEntry }>())
export const lockApprovalFailure = createAction('[Approval API] Lock Approval Failure', props<{ error: string; requestId: string }>())

import { inject, Injectable } from '@angular/core'
import { HttpClient } from '@angular/common/http'
import { delay, map, Observable, of, throwError } from 'rxjs'
import type { ApprovalRole, ApprovalSignature, ApprovalSnapshot, AuditEntry, RoutePackage } from '../types'

/** 冲突错误：旧快照提交会签时返回（对应 409） */
export class ConflictError extends Error {
  readonly conflict = true
  constructor(message: string) {
    super(message)
    this.name = 'ConflictError'
  }
}

@Injectable({ providedIn: 'root' })
export class RouteApiService {
  private readonly http = inject(HttpClient)

  // ---- 内存版后端（演示用） ----
  private readonly snapshots = new Map<string, ApprovalSnapshot>()
  private readonly activeByRoute = new Map<string, string>()
  private readonly lockAttempts = new Map<string, number>()
  private auditSeq = 100

  getRoutePackages() {
    return this.http.get<{ items: RoutePackage[] }>('route-data.json').pipe(map((response) => response.items))
  }

  /** 送审：冻结风险区段与许可，生成快照；同运输单已有审批中快照则幂等返回 */
  submitForReview(route: RoutePackage, version: number, frozenBy: string): Observable<{ snapshot: ApprovalSnapshot; audit: AuditEntry }> {
    const existingId = this.activeByRoute.get(route.id)
    if (existingId) {
      const existing = this.snapshots.get(existingId)
      if (existing && existing.status === '审批中') {
        return of({ snapshot: { ...existing }, audit: { id: `AUD-${++this.auditSeq}`, routeId: route.id, snapshotId: existing.id, at: existing.frozenAt, type: '送审' as const, description: `运输单 ${route.id} 已在审批中（快照 ${existing.id}），不重复冻结` } }).pipe(delay(150))
      }
    }
    const snapshot: ApprovalSnapshot = {
      id: `SS-${route.id}-${version}`,
      routeId: route.id,
      version,
      status: '审批中',
      frozenAt: new Date().toISOString(),
      frozenBy,
      segments: route.segments.map((segment) => ({ ...segment })),
      permission: route.permission,
      permit: route.permit,
      score: route.score,
      signatures: [],
    }
    this.snapshots.set(snapshot.id, snapshot)
    this.activeByRoute.set(route.id, snapshot.id)
    const audit: AuditEntry = {
      id: `AUD-${++this.auditSeq}`,
      routeId: route.id,
      snapshotId: snapshot.id,
      at: snapshot.frozenAt,
      type: '送审',
      description: `运输单 ${route.id} 送审冻结：${route.segments.length} 个区段、许可 ${route.permit}`,
    }
    return of({ snapshot, audit }).pipe(delay(300))
  }

  /** 会签：按当前快照签署；旧快照或已失效快照报冲突 */
  signSnapshot(snapshotId: string, role: ApprovalRole, author: string): Observable<{ signature: ApprovalSignature; audit: AuditEntry | null }> {
    const snapshot = this.snapshots.get(snapshotId)
    if (!snapshot) {
      return throwError(() => new ConflictError('快照不存在，请刷新后按当前快照签署'))
    }
    const activeId = this.activeByRoute.get(snapshot.routeId)
    if (snapshot.status !== '审批中' || activeId !== snapshotId) {
      return throwError(() => new ConflictError('审批快照已过期（旧快照），请刷新后按当前快照签署'))
    }
    const existing = snapshot.signatures.find((item) => item.role === role)
    if (existing) {
      // 幂等：同角色重复签署不产生新记录
      return of({ signature: existing, audit: null }).pipe(delay(150))
    }
    const signature: ApprovalSignature = {
      role, author, signedAt: new Date().toISOString(), status: '已签署', snapshotVersion: snapshot.version,
    }
    snapshot.signatures.push(signature)
    const audit: AuditEntry = {
      id: `AUD-${++this.auditSeq}`,
      routeId: snapshot.routeId,
      snapshotId,
      at: signature.signedAt,
      type: '签署',
      description: `${role} · ${author} 按快照 v${snapshot.version} 签署`,
    }
    return of({ signature, audit }).pipe(delay(200))
  }

  /** 锁定：三方签完才锁定；按请求编号幂等，首次失败、重试成功 */
  lockApproval(snapshotId: string, requestId: string): Observable<{ snapshot: ApprovalSnapshot; audit: AuditEntry }> {
    const snapshot = this.snapshots.get(snapshotId)
    if (!snapshot) {
      return throwError(() => new Error('快照不存在'))
    }
    // 幂等：同一请求编号已锁定，直接返回原结果，不重复写审计
    if (snapshot.status === '已锁定' && snapshot.lockRequestId === requestId) {
      const audit: AuditEntry = {
        id: `AUD-LOCK-${requestId}`,
        routeId: snapshot.routeId, snapshotId, requestId, at: snapshot.lockedAt!,
        type: '锁定', description: `审批已锁定（请求 ${requestId} 幂等重试，无重复记录）`,
      }
      return of({ snapshot: { ...snapshot }, audit }).pipe(delay(150))
    }
    const signedRoles = new Set(snapshot.signatures.filter((item) => item.status === '已签署').map((item) => item.role))
    const required: ApprovalRole[] = ['安全', '运营', '应急']
    const missing = required.filter((role) => !signedRoles.has(role))
    if (missing.length) {
      return throwError(() => new Error(`缺少会签：${missing.join('、')}，三方签完后方可锁定`))
    }
    // 模拟首次锁定失败：保留原快照，按请求编号重试即成功
    const attempts = (this.lockAttempts.get(requestId) ?? 0) + 1
    this.lockAttempts.set(requestId, attempts)
    if (attempts === 1) {
      return throwError(() => new Error('锁定服务暂时不可用，请按原请求编号重试（原快照已保留）')).pipe(delay(400))
    }
    snapshot.status = '已锁定'
    snapshot.lockRequestId = requestId
    snapshot.lockedAt = new Date().toISOString()
    const audit: AuditEntry = {
      id: `AUD-${++this.auditSeq}`,
      routeId: snapshot.routeId,
      snapshotId,
      requestId,
      at: snapshot.lockedAt,
      type: '锁定',
      description: `三方会签完成，审批锁定并写入审计基线（请求 ${requestId}）`,
    }
    return of({ snapshot: { ...snapshot }, audit }).pipe(delay(300))
  }
}

import { Component, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { Store } from '@ngrx/store'
import { MatButtonModule } from '@angular/material/button'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatInputModule } from '@angular/material/input'
import { MatSelectModule } from '@angular/material/select'
import { MatTabsModule } from '@angular/material/tabs'
import { MatChipsModule } from '@angular/material/chips'
import { MatProgressBarModule } from '@angular/material/progress-bar'
import { RouteState } from '../store/route.reducer'
import * as RouteActions from '../store/route.actions'
import type { ApprovalRole, ApprovalSnapshot, RoutePackage } from '../types'

const ROLES: ApprovalRole[] = ['安全', '运营', '应急']

@Component({
  selector: 'app-approval',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatTabsModule, MatChipsModule, MatProgressBarModule],
  template: `
    <main class="page">
      <div class="page-head"><div><p class="eyebrow">安全 · 运营 · 应急会签</p><h1>按快照逐区段会签与锁定</h1><p>送审冻结风险与许可，三方按同一快照签署；旧快照提交报冲突，签完才锁定并写入审计时间线。</p></div></div>

      <!-- 快照状态条 -->
      <section class="card snapshot-bar">
        @if (activeSnapshot) {
          <div class="snapshot-head">
            <div><span class="snapshot-id">{{ activeSnapshot.id }}</span><mat-chip highlighted>审批中</mat-chip></div>
            <small>v{{ activeSnapshot.version }} · 冻结于 {{ activeSnapshot.frozenAt }} · {{ activeSnapshot.frozenBy }}</small>
          </div>
          <p class="snapshot-note">已冻结 {{ activeSnapshot.segments.length }} 个区段风险与许可（{{ activeSnapshot.permit }}），三方按此快照签署。</p>
        } @else if (lockedSnapshot) {
          <div class="snapshot-head">
            <div><span class="snapshot-id">{{ lockedSnapshot.id }}</span><mat-chip>已锁定</mat-chip></div>
            <small>锁定于 {{ lockedSnapshot.lockedAt }} · 请求 {{ lockedSnapshot.lockRequestId }}</small>
          </div>
          <p class="snapshot-note">三方会签完成，审批已锁定并写入审计基线，记录只读保存。</p>
        } @else if (invalidatedSnapshot) {
          <div class="snapshot-head">
            <div><span class="snapshot-id">{{ invalidatedSnapshot.id }}</span><mat-chip color="warn">已失效</mat-chip></div>
            <small>受影响角色：<b class="risk-high">{{ affectedRoles.join('、') || '无' }}</b> · 旧会签不再放行</small>
          </div>
          <p class="snapshot-note">送审后风险或许可发生变更，原快照已失效。请重新送审冻结当前风险与许可。</p>
        } @else {
          <div class="snapshot-head"><div><span class="snapshot-id">未送审</span></div></div>
          <p class="snapshot-note">当前草案尚未冻结。送审将冻结区段风险与许可，此后改动会让未完成会签失效。</p>
        }
        <div class="snapshot-actions">
          @if (!activeSnapshot) {
            <button mat-flat-button color="primary" (click)="submitForReview()">送审冻结快照</button>
          }
          @if (invalidatedSnapshot) {
            <button mat-flat-button color="primary" (click)="submitForReview()">重新送审</button>
            <button mat-stroked-button color="warn" (click)="demoConflict()">按旧快照签署（演示 409 冲突）</button>
          }
        </div>
      </section>

      @if (state?.error) { <p class="banner error">{{ state?.error }}</p> }
      @if (state?.signConflict) { <p class="banner conflict">冲突：{{ state?.signError }}</p> }
      @else if (state?.signError) { <p class="banner error">{{ state?.signError }}</p> }

      <mat-tab-group>
        <mat-tab label="会签">
          <section class="card sign-grid">
            @for (role of roles; track role) {
              <div class="sign-card" [class.signed]="signatureOf(role)?.status === '已签署'" [class.invalidated]="signatureOf(role)?.status === '已失效'">
                <div class="sign-head"><b>{{ role }}专业</b>
                  @if (signatureOf(role)?.status === '已签署') { <mat-chip color="primary">已签署</mat-chip> }
                  @else if (signatureOf(role)?.status === '已失效') { <mat-chip color="warn">已失效</mat-chip> }
                  @else { <mat-chip>待签署</mat-chip> }
                </div>
                @if (signatureOf(role); as sig) {
                  <p class="sign-meta">{{ sig.author }} · v{{ sig.snapshotVersion }} · {{ sig.signedAt }}</p>
                } @else {
                  <p class="sign-meta">尚未签署</p>
                }
                <div class="sign-actions">
                  <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>签署人</mat-label><input matInput [(ngModel)]="author" /></mat-form-field>
                  <button mat-flat-button color="primary" [disabled]="!activeSnapshot || signatureOf(role)?.status === '已签署'" (click)="sign(role)">
                    {{ signatureOf(role)?.status === '已失效' ? '重新签署' : '签署' }}
                  </button>
                </div>
              </div>
            }
          </section>

          <section class="card lock-bar">
            <div class="lock-info">
              <b>三方会签完成后锁定</b>
              <small>锁定按请求编号幂等提交；若锁定失败，保留原快照，可按原请求编号重试，不产生半条审批或重复记录。</small>
            </div>
            @if (state?.locking) { <mat-progress-bar mode="indeterminate" /> }
            @if (state?.lockError) { <p class="banner error">{{ state?.lockError }}</p> }
            <div class="lock-actions">
              @if (lockedSnapshot) {
                <button mat-flat-button color="primary" disabled>已锁定</button>
              } @else if (state?.lockError && currentRequestId) {
                <button mat-stroked-button color="warn" (click)="retryLock()">按请求编号重试（{{ currentRequestId }}）</button>
              } @else {
                <button mat-flat-button color="primary" [disabled]="!allSigned || state?.locking" (click)="lock()">确认并锁定基线</button>
              }
            </div>
          </section>
        </mat-tab>

        <mat-tab label="区段意见">
          <section class="card form-card">
            <div class="two"><mat-form-field><mat-label>专业角色</mat-label><mat-select [(ngModel)]="role"><mat-option>安全</mat-option><mat-option>运营</mat-option><mat-option>应急</mat-option></mat-select></mat-form-field><mat-form-field><mat-label>区段</mat-label><mat-select [(ngModel)]="segmentId"><mat-option *ngFor="let segment of segments" [value]="segment.id">{{segment.id}} · {{segment.name}}</mat-option></mat-select></mat-form-field></div>
            <mat-form-field class="wide"><mat-label>审批条件与依据</mat-label><textarea matInput rows="5" [(ngModel)]="content" placeholder="明确区段、约束、时限与验收证据"></textarea></mat-form-field>
            <button mat-flat-button color="primary" [disabled]="!content.trim()" (click)="addComment()">提交意见</button>
          </section>
          <section class="card comment-list">
            @for (comment of (state$ | async)?.comments || []; track comment.id) {
              <div class="comment"><div class="comment-head"><div><b>{{comment.role}} · {{comment.author}}</b><small>{{comment.segmentId}} · {{comment.id}}</small></div><span>{{comment.status}}</span></div><p>{{comment.content}}</p>
              <div class="actions"><button mat-stroked-button color="warn" (click)="resolve(comment.id,'已退回')">退回补件</button><button mat-flat-button color="primary" (click)="resolve(comment.id,'已接受')">接受条件</button></div></div>
            }
          </section>
        </mat-tab>

        <mat-tab label="审计时间线">
          <section class="card timeline">
            @for (entry of (state$ | async)?.auditEntries || []; track entry.id) {
              <div><i [class]="'dot-' + entry.type"></i><b>{{ entry.at }} · {{ entry.type }}</b><p>{{ entry.description }}</p></div>
            } @empty {
              <div><i></i><b>暂无审计记录</b><p>送审、签署、失效与锁定都会写入时间线。</p></div>
            }
          </section>
        </mat-tab>
      </mat-tab-group>
    </main>
  `,
  styles: [`
    h2,h3{margin:0 0 12px}.snapshot-bar{margin-bottom:14px}.snapshot-head{display:flex;align-items:center;gap:12px}.snapshot-head>div{display:flex;align-items:center;gap:10px}.snapshot-id{font-family:ui-monospace,monospace;font-weight:700;color:#2563eb}.snapshot-note{color:#475569;margin:10px 0 0}.snapshot-actions{margin-top:12px}.banner{padding:10px 14px;border-radius:6px;margin:0 0 12px}.banner.error{background:#fef2f2;color:#b91c1c}.banner.conflict{background:#fffbeb;color:#b45309}.sign-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:14px}.sign-card{border:1px solid #e1e7ef;border-radius:8px;padding:14px}.sign-card.signed{border-color:#16a34a;background:#f0fdf4}.sign-card.invalidated{border-color:#dc2626;background:#fef2f2}.sign-head{display:flex;justify-content:space-between;align-items:center}.sign-meta{color:#7a8798;font-size:12px;margin:8px 0}.sign-actions{display:flex;flex-direction:column;gap:8px}.sign-actions mat-form-field{width:100%}.lock-bar{margin-bottom:14px}.lock-info{display:flex;flex-direction:column;gap:4px;margin-bottom:10px}.lock-info small{color:#7a8798}.lock-actions{margin-top:6px}.comment-list{padding:0}.comment{padding:18px;border-bottom:1px solid #e7ebf1}.comment-head{display:flex;justify-content:space-between}.comment-head small{display:block;color:#7a8798;margin-top:4px}.comment p{color:#475569}.actions{display:flex;gap:10px}.actions button{margin:8px 8px 0 0}.form-card{margin-bottom:14px}.two{display:grid;grid-template-columns:1fr 1fr;gap:14px}.two mat-form-field,.wide{width:100%}.timeline{padding:8px 18px}.timeline>div{position:relative;padding:14px 10px 14px 28px;border-left:2px solid #cbd5e1}.timeline i{position:absolute;width:9px;height:9px;border-radius:50%;left:-5.5px;top:20px;background:#2563eb}.timeline i.dot-失效{background:#dc2626}.timeline i.dot-锁定{background:#16a34a}.timeline i.dot-冲突{background:#d97706}.timeline p{color:#7a8798;margin:5px 0 0}
    @media(max-width:820px){.sign-grid{grid-template-columns:1fr}.two{grid-template-columns:1fr}}
  `],
})
export class ApprovalComponent {
  private readonly store = inject(Store<{ routes: RouteState }>)
  readonly state$ = this.store.select('routes')
  readonly roles = ROLES
  state: RouteState | null = null

  // 会签表单
  author = '当前审阅人'
  role = '安全'
  segmentId = 'S-203'
  content = ''
  segments: RoutePackage['segments'] = []

  // 锁定请求编号（幂等键）
  currentRequestId = ''

  constructor() {
    this.state$.subscribe((state: RouteState) => {
      this.state = state
      this.segments = state.routes.flatMap((route: RoutePackage) => route.segments)
    })
  }

  get selectedRouteId(): string { return this.state?.selectedRouteId ?? '' }

  get activeSnapshot(): ApprovalSnapshot | undefined {
    return this.state?.snapshots.find((snapshot) => snapshot.routeId === this.selectedRouteId && snapshot.status === '审批中')
  }

  get lockedSnapshot(): ApprovalSnapshot | undefined {
    return this.state?.snapshots.find((snapshot) => snapshot.routeId === this.selectedRouteId && snapshot.status === '已锁定')
  }

  get invalidatedSnapshot(): ApprovalSnapshot | undefined {
    return this.state?.snapshots.find((snapshot) => snapshot.routeId === this.selectedRouteId && snapshot.status === '已失效')
  }

  get affectedRoles(): ApprovalRole[] {
    const snapshot = this.invalidatedSnapshot
    if (!snapshot) return []
    return snapshot.signatures.filter((signature) => signature.status === '已失效').map((signature) => signature.role)
  }

  signatureOf(role: ApprovalRole) {
    // 优先取当前审批中快照；失效后回退到已失效快照以展示旧会签状态
    const snapshot = this.activeSnapshot ?? this.invalidatedSnapshot
    return snapshot?.signatures.find((signature) => signature.role === role)
  }

  get allSigned(): boolean {
    if (!this.activeSnapshot) return false
    return ROLES.every((role) => this.activeSnapshot!.signatures.some((signature) => signature.role === role && signature.status === '已签署'))
  }

  submitForReview() {
    if (!this.selectedRouteId) return
    this.store.dispatch(RouteActions.submitForReview({ routeId: this.selectedRouteId }))
  }

  /** 演示：对已失效的旧快照提交会签，服务端应报 409 冲突 */
  demoConflict() {
    if (!this.invalidatedSnapshot) return
    this.store.dispatch(RouteActions.signSnapshot({ snapshotId: this.invalidatedSnapshot.id, role: '安全', author: this.author || '当前审阅人' }))
  }

  sign(role: ApprovalRole) {
    if (!this.activeSnapshot) return
    this.store.dispatch(RouteActions.signSnapshot({ snapshotId: this.activeSnapshot.id, role, author: this.author || '当前审阅人' }))
  }

  lock() {
    if (!this.activeSnapshot) return
    this.currentRequestId = `REQ-${Date.now()}`
    this.store.dispatch(RouteActions.lockApproval({ snapshotId: this.activeSnapshot.id, requestId: this.currentRequestId }))
  }

  retryLock() {
    if (!this.activeSnapshot || !this.currentRequestId) return
    this.store.dispatch(RouteActions.lockApproval({ snapshotId: this.activeSnapshot.id, requestId: this.currentRequestId }))
  }

  addComment() { this.store.dispatch(RouteActions.addComment({ comment: { id: `RV-${Date.now().toString().slice(-4)}`, segmentId: this.segmentId, role: this.role, author: '当前审阅人', content: this.content, status: '待确认' } })); this.content = '' }
  resolve(id: string, status: '已接受' | '已退回') { this.store.dispatch(RouteActions.resolveComment({ id, status })) }
}

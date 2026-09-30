import { Component, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { Store } from '@ngrx/store'
import { MatButtonModule } from '@angular/material/button'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatInputModule } from '@angular/material/input'
import { MatSelectModule } from '@angular/material/select'
import { MatTabsModule } from '@angular/material/tabs'
import { RouteState } from '../store/route.reducer'
import * as RouteActions from '../store/route.actions'
import type { ApprovalRole, ApprovalSnapshot, AuditEntry, RoutePackage } from '../types'

const ROLES: ApprovalRole[] = ['安全', '运营', '应急']

@Component({
  selector: 'app-approval',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatTabsModule],
  template: `
    <main class="page">
      <div class="page-head">
        <div><p class="eyebrow">安全 · 运营 · 应急会签</p><h1>审批快照与三方会签</h1><p>运输单、风险区段与会签绑定同一份快照：送审即冻结，改动即失效，三方签齐才锁定。</p></div>
        <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>运输单</mat-label><mat-select [ngModel]="selectedRouteId" (ngModelChange)="selectRoute($event)">@for (route of routes; track route.id) { <mat-option [value]="route.id">{{route.id}} · {{route.trainCode}}</mat-option> }</mat-select></mat-form-field>
      </div>
      @if (conflict) { <div class="conflict"><span>⚠ {{conflict}}</span><button mat-button color="warn" (click)="dismissConflict()">知道了</button></div> }
      <mat-tab-group>
        <mat-tab label="会签快照">
          @if (snapshot; as snap) {
            <section class="card">
              <div class="snap-head"><div><b>{{snap.id}}</b><small>第 {{snap.revision}} 版 · 冻结于 {{snap.frozenAt}} · {{snap.frozenBy}}</small></div><span class="chip" [class.chip-ok]="snap.status==='已锁定'" [class.chip-warn]="snap.status==='已失效'">{{snap.status}}</span></div>
              <div class="frozen"><span>许可状态 <b [class.risk-high]="snap.frozenPermission!=='有效'">{{snap.frozenPermission}}</b></span><span>许可证 <b>{{snap.frozenPermit}}</b></span><span>冻结风险分 <b [class.risk-high]="snap.frozenScore>=70">{{ snap.frozenScore }}</b></span></div>
              <table class="frozen-table">
                <thead><tr><th>区段</th><th>名称</th><th>冻结风险等级</th><th>状态</th><th>限速</th></tr></thead>
                <tbody>@for (segment of snap.frozenSegments; track segment.id) { <tr><td>{{segment.id}}</td><td>{{segment.name}}</td><td><b [class.risk-high]="segment.level==='高'" [class.risk-mid]="segment.level==='中'" [class.risk-low]="segment.level==='低'">{{segment.level}}</b></td><td>{{segment.status}}</td><td>{{segment.speed}}</td></tr> }</tbody>
              </table>
              @if (snap.status === '已失效') {
                <div class="invalid">
                  <p>风险区段或许可已变更，本版会签失效。
                    @if (snap.affectedRoles.length) { <span>受影响角色：<b class="risk-high">{{snap.affectedRoles.join('、')}}</b>（已签署作废，需重新会签）</span> } @else { <span>变更时尚无角色签署。</span> }
                  </p>
                  <button mat-flat-button color="primary" (click)="submit()">重新送审（冻结最新风险与许可）</button>
                </div>
              }
            </section>
            @if (snap.status !== '已失效') {
              <section class="card">
                <h2>三方会签（按当前快照第 {{snap.revision}} 版签署）</h2>
                <div class="roles">
                  @for (role of roles; track role) {
                    <div class="role-card" [class.signed]="!!signatureOf(role)">
                      <div class="role-head"><b>{{role}}</b><span class="chip" [class.chip-ok]="!!signatureOf(role)">{{ signatureOf(role) ? '已签署' : '待签署' }}</span></div>
                      @if (signatureOf(role); as sig) { <small>{{sig.signer}} · {{sig.signedAt}}</small> }
                      @else { <button mat-stroked-button color="primary" [disabled]="snap.status!=='会签中'" (click)="sign(role)">以{{role}}身份签署</button> }
                    </div>
                  }
                </div>
                <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>签署人</mat-label><input matInput [(ngModel)]="signer"></mat-form-field>
              </section>
              <section class="card">
                <h2>基线锁定</h2>
                @if (snap.status === '已锁定') {
                  <p>✅ 三方会签完成，已于 {{snap.lockedAt}} 锁定并写入审计时间线（请求编号 {{snap.lockRequestId}}），风险与许可转入只读。</p>
                } @else {
                  <p>三方签齐后方可锁定；锁定失败保留原快照，可按同一请求编号重试，不会留下半条审批或重复记录。</p>
                  @if (lockStatus === 'failed') {
                    <p class="risk-high">锁定失败：{{lockError}}</p>
                    <button mat-flat-button color="warn" (click)="lock()">按请求编号 {{snap.lockRequestId}} 重试</button>
                  } @else {
                    <button mat-flat-button color="primary" [disabled]="!allSigned || lockStatus==='pending'" (click)="lock()">{{ lockStatus === 'pending' ? '锁定写入中…' : '确认三方签齐并锁定基线' }}</button>
                    @if (!allSigned) { <small class="hint">还差：{{missingRoles.join('、')}}</small> }
                  }
                }
              </section>
            }
          } @else {
            <section class="card empty">
              <p>运输单 {{selectedRouteId || '—'}} 尚未送审。提交后将冻结当前风险区段与许可状态，生成第 1 版审批快照，之后任何改动都会让未完成会签失效。</p>
              <button mat-flat-button color="primary" [disabled]="!selectedRouteId" (click)="submit()">提交送审（冻结风险与许可）</button>
            </section>
          }
          @if (historySnapshots.length) {
            <section class="card">
              <h3>快照历史</h3>
              @for (old of historySnapshots; track old.id) {
                <div class="history"><b>{{old.id}}</b><span class="chip" [class.chip-warn]="old.status==='已失效'" [class.chip-ok]="old.status==='已锁定'">{{old.status}}</span><small>第 {{old.revision}} 版 · 冻结于 {{old.frozenAt}}<span>@if (old.affectedRoles.length) { · 受影响角色：{{old.affectedRoles.join('、')}} }</span></small></div>
              }
            </section>
          }
        </mat-tab>
        <mat-tab label="区段意见">
          <section class="card comment-list">
            @for (comment of comments; track comment.id) {
              <div class="comment"><div class="comment-head"><div><b>{{comment.role}} · {{comment.author}}</b><small>{{comment.segmentId}} · {{comment.id}}</small></div><span>{{comment.status}}</span></div><p>{{comment.content}}</p>
              <div class="actions"><button mat-stroked-button color="warn" (click)="resolve(comment.id,'已退回')">退回补件</button><button mat-flat-button color="primary" (click)="resolve(comment.id,'已接受')">接受条件</button></div></div>
            }
          </section>
          <section class="card form-card">
            <div class="two"><mat-form-field><mat-label>专业角色</mat-label><mat-select [(ngModel)]="role"><mat-option>安全</mat-option><mat-option>运营</mat-option><mat-option>应急</mat-option></mat-select></mat-form-field><mat-form-field><mat-label>区段</mat-label><mat-select [(ngModel)]="segmentId"><mat-option *ngFor="let segment of segments" [value]="segment.id">{{segment.id}} · {{segment.name}}</mat-option></mat-select></mat-form-field></div>
            <mat-form-field class="wide"><mat-label>审批条件与依据</mat-label><textarea matInput rows="5" [(ngModel)]="content" placeholder="明确区段、约束、时限与验收证据"></textarea></mat-form-field>
            <button mat-flat-button color="primary" [disabled]="!content.trim()" (click)="addComment()">提交意见</button>
          </section>
        </mat-tab>
        <mat-tab label="审计时间线">
          <section class="card timeline">
            @for (entry of audit; track entry.id) {
              <div><i></i><b>{{entry.at}} · {{entry.actor}} · {{entry.action}}</b><p>{{entry.detail}}</p></div>
            }
          </section>
        </mat-tab>
      </mat-tab-group>
    </main>
  `,
  styles: [`
    h2{margin:0 0 12px}h3{margin:0 0 10px}.comment-list{padding:0;margin-bottom:14px}.comment{padding:18px;border-bottom:1px solid #e7ebf1}.comment-head{display:flex;justify-content:space-between}.comment-head small{display:block;color:#7a8798;margin-top:4px}.comment p{color:#475569}.actions{display:flex;gap:10px}.actions button{margin:8px 8px 0 0}.form-card{max-width:780px}.two{display:grid;grid-template-columns:1fr 1fr;gap:14px}.two mat-form-field,.wide{width:100%}.timeline{padding:8px 18px}.timeline>div{position:relative;padding:14px 10px 14px 28px;border-left:2px solid #cbd5e1}.timeline i{position:absolute;width:9px;height:9px;border-radius:50%;background:#2563eb;left:-5.5px;top:20px}.timeline p{color:#7a8798;margin:5px 0 0}
    .conflict{display:flex;justify-content:space-between;align-items:center;gap:12px;background:#fef2f2;border:1px solid #fecaca;color:#b91c1c;border-radius:8px;padding:10px 14px;margin-bottom:14px;font-weight:600}
    .snap-head{display:flex;justify-content:space-between;align-items:flex-start}.snap-head b{font-size:16px}.snap-head small{display:block;color:#7a8798;margin-top:4px}
    .chip{display:inline-block;padding:3px 10px;border-radius:999px;background:#eef2f7;color:#475569;font-size:12px;font-weight:700}.chip-ok{background:#dcfce7;color:#15803d}.chip-warn{background:#fee2e2;color:#b91c1c}
    .frozen{display:flex;flex-wrap:wrap;gap:22px;margin:14px 0;color:#667085}.frozen b{color:#182230;margin-left:4px}
    .frozen-table{width:100%;border-collapse:collapse;font-size:13px}.frozen-table th,.frozen-table td{text-align:left;padding:8px 10px;border-bottom:1px solid #edf0f5}.frozen-table th{color:#7a8798;font-weight:600}
    .invalid{margin-top:14px;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:12px 14px}.invalid p{color:#9a3412;margin:0 0 10px}
    .roles{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-bottom:14px}.role-card{border:1px solid #e1e7ef;border-radius:8px;padding:14px;display:flex;flex-direction:column;gap:8px;align-items:flex-start}.role-card.signed{border-color:#86efac;background:#f0fdf4}.role-head{display:flex;justify-content:space-between;width:100%;align-items:center}.role-card small{color:#7a8798}
    .hint{margin-left:10px;color:#7a8798}.empty p{margin-bottom:12px}.history{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid #edf0f5}.history small{color:#7a8798}
    @media(max-width:900px){.roles{grid-template-columns:1fr}}
    @media(max-width:620px){.two{grid-template-columns:1fr}}
  `],
})
export class ApprovalComponent {
  private readonly store = inject(Store<{ routes: RouteState }>)
  readonly state$ = this.store.select('routes')
  readonly roles = ROLES
  role = '安全'
  segmentId = 'S-203'
  content = ''
  signer = '韩洁'
  routes: RoutePackage[] = []
  segments: RoutePackage['segments'] = []
  comments: RouteState['comments'] = []
  audit: AuditEntry[] = []
  snapshots: ApprovalSnapshot[] = []
  selectedRouteId = ''
  conflict = ''
  lockError = ''
  lockRequests: RouteState['lockRequests'] = {}

  constructor() {
    this.state$.pipe(takeUntilDestroyed()).subscribe((state) => {
      this.routes = state.routes
      this.segments = state.routes.flatMap((route: RoutePackage) => route.segments)
      this.comments = state.comments
      this.audit = state.audit
      this.snapshots = state.snapshots
      this.selectedRouteId = state.selectedRouteId
      this.conflict = state.lastConflict
      this.lockError = state.lockError
      this.lockRequests = state.lockRequests
    })
  }

  get routeSnapshots() { return this.snapshots.filter((snapshot) => snapshot.routeId === this.selectedRouteId).sort((a, b) => b.revision - a.revision) }
  get snapshot(): ApprovalSnapshot | undefined { return this.routeSnapshots[0] }
  get historySnapshots() { return this.routeSnapshots.slice(1) }
  signatureOf(role: ApprovalRole) { const snap = this.snapshot; return snap?.signatures.find((signature) => signature.role === role && signature.status === '有效' && signature.revision === snap.revision) }
  get missingRoles() { return this.roles.filter((role) => !this.signatureOf(role)) }
  get allSigned() { return this.missingRoles.length === 0 }
  get lockStatus() { const snap = this.snapshot; return snap?.lockRequestId ? (this.lockRequests[snap.lockRequestId] ?? 'idle') : 'idle' }

  selectRoute(id: string) { this.store.dispatch(RouteActions.selectRoute({ id })) }
  submit() { this.store.dispatch(RouteActions.submitForApproval({ routeId: this.selectedRouteId, actor: this.signer.trim() || '当前审阅人' })) }
  sign(role: ApprovalRole) { const snap = this.snapshot; if (snap) this.store.dispatch(RouteActions.signSnapshot({ snapshotId: snap.id, revision: snap.revision, role, signer: this.signer.trim() || '当前审阅人' })) }
  lock() {
    const snap = this.snapshot
    if (!snap) return
    // 失败后重试沿用原请求编号，保证幂等；首次锁定生成新编号
    const requestId = this.lockStatus === 'failed' && snap.lockRequestId ? snap.lockRequestId : `LQ-${this.selectedRouteId}-${Date.now()}`
    this.store.dispatch(RouteActions.lockSnapshot({ snapshotId: snap.id, requestId, actor: this.signer.trim() || '当前审阅人' }))
  }
  dismissConflict() { this.store.dispatch(RouteActions.clearConflict()) }
  addComment() { this.store.dispatch(RouteActions.addComment({ comment: { id: `RV-${Date.now().toString().slice(-4)}`, segmentId: this.segmentId, role: this.role, author: '当前审阅人', content: this.content, status: '待确认' } })); this.content = '' }
  resolve(id: string, status: '已接受' | '已退回') { this.store.dispatch(RouteActions.resolveComment({ id, status })) }
}

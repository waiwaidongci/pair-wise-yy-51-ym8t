import { inject, Injectable } from '@angular/core'
import { Actions, createEffect, ofType } from '@ngrx/effects'
import { Store } from '@ngrx/store'
import { catchError, filter, finalize, map, of, switchMap, withLatestFrom } from 'rxjs'
import { RouteApiService } from '../services/route-api.service'
import { RouteState } from './route.reducer'
import * as RouteActions from './route.actions'

@Injectable()
export class RouteEffects {
  private readonly actions$ = inject(Actions)
  private readonly api = inject(RouteApiService)
  private readonly store = inject(Store<{ routes: RouteState }>)
  /** 正在写入的锁定请求编号，拦截在飞期间的重复触发 */
  private readonly inFlightLocks = new Set<string>()

  loadRoutes$ = createEffect(() => this.actions$.pipe(
    ofType(RouteActions.loadRoutes),
    switchMap(() => this.api.getRoutePackages().pipe(
      map((routes) => RouteActions.loadRoutesSuccess({ routes })),
      catchError((error: unknown) => of(RouteActions.loadRoutesFailure({ error: error instanceof Error ? error.message : '无法读取路径数据' }))),
    )),
  ))

  lockSnapshot$ = createEffect(() => this.actions$.pipe(
    ofType(RouteActions.lockSnapshot),
    withLatestFrom(this.store.select('routes')),
    // reducer 已先把接受的请求登记为 pending；被幂等规则或校验拦下的请求不会进入持久化
    filter(([action, state]) => state.lockRequests[action.requestId] === 'pending' && !this.inFlightLocks.has(action.requestId)),
    switchMap(([action]) => {
      this.inFlightLocks.add(action.requestId)
      return this.api.persistLock(action.requestId).pipe(
        map(() => RouteActions.lockSnapshotSuccess({ snapshotId: action.snapshotId, requestId: action.requestId, actor: action.actor })),
        catchError((error: unknown) => of(RouteActions.lockSnapshotFailure({
          snapshotId: action.snapshotId,
          requestId: action.requestId,
          error: error instanceof Error ? error.message : '锁定写入失败',
        }))),
        finalize(() => this.inFlightLocks.delete(action.requestId)),
      )
    }),
  ))
}

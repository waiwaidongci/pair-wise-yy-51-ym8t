import { inject, Injectable } from '@angular/core'
import { Actions, createEffect, ofType } from '@ngrx/effects'
import { Store } from '@ngrx/store'
import { catchError, map, of, switchMap, withLatestFrom } from 'rxjs'
import { RouteApiService } from '../services/route-api.service'
import { ConflictError } from '../services/route-api.service'
import { RouteState } from './route.reducer'
import * as RouteActions from './route.actions'
import type { RoutePackage } from '../types'

@Injectable()
export class RouteEffects {
  private readonly actions$ = inject(Actions)
  private readonly api = inject(RouteApiService)
  private readonly store = inject(Store<{ routes: RouteState }>)

  loadRoutes$ = createEffect(() => this.actions$.pipe(
    ofType(RouteActions.loadRoutes),
    switchMap(() => this.api.getRoutePackages().pipe(
      map((routes) => RouteActions.loadRoutesSuccess({ routes })),
      catchError((error: unknown) => of(RouteActions.loadRoutesFailure({ error: error instanceof Error ? error.message : '无法读取路径数据' }))),
    )),
  ))

  submitForReview$ = createEffect(() => this.actions$.pipe(
    ofType(RouteActions.submitForReview),
    withLatestFrom(this.store.select('routes')),
    switchMap(([action, state]) => {
      const route = state.routes.find((item: RoutePackage) => item.id === action.routeId)
      if (!route) return of(RouteActions.submitForReviewFailure({ error: '未找到运输单' }))
      return this.api.submitForReview(route, state.version, '当前审阅人').pipe(
        map(({ snapshot, audit }) => RouteActions.submitForReviewSuccess({ snapshot, audit })),
        catchError((error: unknown) => of(RouteActions.submitForReviewFailure({ error: error instanceof Error ? error.message : '送审失败' }))),
      )
    }),
  ))

  signSnapshot$ = createEffect(() => this.actions$.pipe(
    ofType(RouteActions.signSnapshot),
    switchMap((action) => this.api.signSnapshot(action.snapshotId, action.role, action.author).pipe(
      map(({ signature, audit }) => RouteActions.signSnapshotSuccess({ snapshotId: action.snapshotId, signature, audit })),
      catchError((error: unknown) => of(RouteActions.signSnapshotFailure({
        error: error instanceof Error ? error.message : '签署失败',
        conflict: error instanceof ConflictError,
      }))),
    )),
  ))

  lockApproval$ = createEffect(() => this.actions$.pipe(
    ofType(RouteActions.lockApproval),
    switchMap((action) => this.api.lockApproval(action.snapshotId, action.requestId).pipe(
      map(({ snapshot, audit }) => RouteActions.lockApprovalSuccess({ snapshot, audit })),
      catchError((error: unknown) => of(RouteActions.lockApprovalFailure({
        error: error instanceof Error ? error.message : '锁定失败',
        requestId: action.requestId,
      }))),
    )),
  ))
}

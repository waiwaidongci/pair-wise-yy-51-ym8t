import { inject, Injectable } from '@angular/core'
import { HttpClient } from '@angular/common/http'
import { map, timer } from 'rxjs'
import type { RoutePackage } from '../types'

@Injectable({ providedIn: 'root' })
export class RouteApiService {
  private readonly http = inject(HttpClient)
  /** 模拟服务端已持久化的锁定请求编号：同编号重复提交直接返回，不产生重复记录 */
  private readonly persistedLocks = new Set<string>()
  /** 模拟不稳定存储：每个请求编号首次写入失败一次，重试即成功 */
  private readonly failedOnce = new Set<string>()

  getRoutePackages() {
    return this.http.get<{ items: RoutePackage[] }>('route-data.json').pipe(map((response) => response.items))
  }

  /** 持久化锁定结果。整体一次写入：要么完整落库，要么原样保留，不留半条审批 */
  persistLock(requestId: string) {
    return timer(600).pipe(map(() => {
      if (this.persistedLocks.has(requestId)) return requestId
      if (!this.failedOnce.has(requestId)) {
        this.failedOnce.add(requestId)
        throw new Error(`锁定请求 ${requestId} 写入失败（模拟存储故障），快照已原样保留，请按同一请求编号重试`)
      }
      this.persistedLocks.add(requestId)
      return requestId
    }))
  }
}

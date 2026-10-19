// The WorkManager job behind the daily due-date notification: it only asks
// the notifier to post from Room, so it needs no network and never retries.
package io.github.lopezec007.planner.notify

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import io.github.lopezec007.planner.PlannerApp

class DueWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        PlannerApp.graph(applicationContext).notifier.postNow()
        return Result.success()
    }
}

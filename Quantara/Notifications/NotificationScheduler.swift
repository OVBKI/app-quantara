import Foundation
import UserNotifications
import QuantaraCore

/// Notifications intelligentes (§14).
///
/// Toutes facultatives et désactivées par défaut. Le contenu est produit par les moteurs
/// déterministes : une notification n'affiche jamais un chiffre qui n'a pas été calculé.
protocol NotificationScheduling: Sendable {
    func requestAuthorization() async -> Bool
    func refreshSchedule(analysis: FinancialAnalysis, settings: NotificationPreferences) async
    func cancelAll() async
}

struct NotificationPreferences: Sendable {
    var upcomingDebits: Bool
    var budgetOverrun: Bool
    var goalMilestones: Bool
    var monthlyReport: Bool
}

struct NotificationScheduler: NotificationScheduling {

    /// Le centre de notifications n'est pas `Sendable` : on ne le retient pas, on le
    /// redemande à chaque appel. `current()` renvoie de toute façon le même singleton.
    private var center: UNUserNotificationCenter { UNUserNotificationCenter.current() }
    private let locale: Locale

    init(locale: Locale = Locale(identifier: "fr_FR")) {
        self.locale = locale
    }

    func requestAuthorization() async -> Bool {
        (try? await center.requestAuthorization(options: [.alert, .sound, .badge])) ?? false
    }

    func cancelAll() async {
        center.removeAllPendingNotificationRequests()
    }

    func refreshSchedule(analysis: FinancialAnalysis, settings: NotificationPreferences) async {
        // On reprogramme tout à chaque rafraîchissement : maintenir un diff incrémental
        // pour une poignée de notifications coûterait plus qu'il ne rapporte.
        center.removeAllPendingNotificationRequests()

        if settings.upcomingDebits {
            await scheduleUpcomingDebits(analysis)
        }
        if settings.budgetOverrun {
            await scheduleBudgetAlerts(analysis)
        }
        if settings.goalMilestones {
            await scheduleGoalMilestones(analysis)
        }
        if settings.monthlyReport {
            await scheduleMonthlyReport(analysis)
        }
    }

    // MARK: Échéances

    /// Prévient trois jours avant un prélèvement important — le délai utile pour
    /// approvisionner le compte, pas le jour même où il est trop tard.
    private func scheduleUpcomingDebits(_ analysis: FinancialAnalysis) async {
        let calendar = Calendar.current
        for event in analysis.cashFlow.upcomingEvents where event.kind != .income {
            guard event.amount.amount > 50 else { continue }
            guard let fireDate = calendar.date(byAdding: .day, value: -3, to: event.date),
                  fireDate > Date()
            else { continue }

            await add(
                identifier: "debit.\(event.id.uuidString)",
                title: String(localized: "notification.debit.title"),
                body: String(
                    format: String(localized: "notification.debit.body"),
                    event.label,
                    event.amount.formatted(locale: locale)
                ),
                date: fireDate
            )
        }
    }

    // MARK: Budget

    private func scheduleBudgetAlerts(_ analysis: FinancialAnalysis) async {
        // Le découvert projeté est la seule alerte qui vaut une interruption immédiate.
        guard analysis.cashFlow.hasProjectedOverdraft,
              let date = analysis.cashFlow.lowestBalanceDate,
              let fireDate = Calendar.current.date(byAdding: .day, value: -2, to: date),
              fireDate > Date()
        else { return }

        await add(
            identifier: "overdraft",
            title: String(localized: "notification.overdraft.title"),
            body: String(
                format: String(localized: "notification.overdraft.body"),
                analysis.cashFlow.lowestBalance.formatted(locale: locale)
            ),
            date: fireDate
        )
    }

    // MARK: Objectifs

    private func scheduleGoalMilestones(_ analysis: FinancialAnalysis) async {
        for plan in analysis.goalPlans {
            let progress = NSDecimalNumber(decimal: plan.progress).doubleValue
            // Un seul jalon notifié : 70 %. Notifier chaque tranche de 10 % transformerait
            // l'encouragement en nuisance.
            guard progress >= 0.7, progress < 1 else { continue }
            guard let fireDate = Calendar.current.date(byAdding: .day, value: 1, to: Date())
            else { continue }

            await add(
                identifier: "goal.\(plan.goal.id.uuidString)",
                title: String(localized: "notification.goal.title"),
                body: String(
                    format: String(localized: "notification.goal.body"),
                    plan.goal.name,
                    Percent.format(plan.progress, locale: locale, fractionDigits: 0)
                ),
                date: fireDate
            )
        }
    }

    // MARK: Rapport mensuel

    private func scheduleMonthlyReport(_ analysis: FinancialAnalysis) async {
        var components = DateComponents()
        components.day = 1
        components.hour = 9
        let trigger = UNCalendarNotificationTrigger(dateMatching: components, repeats: true)

        let content = UNMutableNotificationContent()
        content.title = String(localized: "notification.report.title")
        content.body = String(localized: "notification.report.body")
        content.sound = .default

        let request = UNNotificationRequest(
            identifier: "monthlyReport",
            content: content,
            trigger: trigger
        )
        try? await center.add(request)
    }

    // MARK: Utilitaire

    private func add(identifier: String, title: String, body: String, date: Date) async {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default

        var components = Calendar.current.dateComponents([.year, .month, .day], from: date)
        components.hour = 9

        let trigger = UNCalendarNotificationTrigger(dateMatching: components, repeats: false)
        let request = UNNotificationRequest(identifier: identifier, content: content, trigger: trigger)
        try? await center.add(request)
    }
}

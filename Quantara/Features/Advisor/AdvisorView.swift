import SwiftUI
import UIKit
import QuantaraCore

@MainActor
@Observable
final class AdvisorViewModel {

    var messages: [AdvisorMessage] = []
    var input: String = ""
    var isResponding = false
    var currentTool: String?
    var errorMessage: String?

    private var streamTask: Task<Void, Never>?

    func load(from store: DataStore) {
        messages = store.chatHistory().map {
            AdvisorMessage(id: $0.id, isFromUser: $0.isFromUser, text: $0.text, date: $0.date)
        }
    }

    func send(
        _ question: String,
        task: AdvisorPrompt.Task = .chat,
        advisor: any AdvisorService,
        store: DataStore
    ) {
        guard !isResponding else { return }
        errorMessage = nil

        let trimmed = question.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        messages.append(AdvisorMessage(isFromUser: true, text: trimmed))
        store.appendChatMessage(trimmed, isFromUser: true)
        input = ""
        isResponding = true

        let history = Array(messages.dropLast())
        let analysis = store.analysis
        let responseID = UUID()
        messages.append(AdvisorMessage(id: responseID, isFromUser: false, text: ""))

        streamTask = Task {
            do {
                let stream = advisor.respond(
                    to: trimmed,
                    analysis: analysis,
                    history: history,
                    task: task
                )
                for try await chunk in stream {
                    switch chunk {
                    case .text(let fragment):
                        currentTool = nil
                        if let index = messages.firstIndex(where: { $0.id == responseID }) {
                            messages[index].text += fragment
                        }
                    case .toolInProgress(let name):
                        currentTool = name
                    case .done:
                        currentTool = nil
                    }
                }
                if let index = messages.firstIndex(where: { $0.id == responseID }) {
                    store.appendChatMessage(messages[index].text, isFromUser: false)
                }
            } catch {
                errorMessage = error.localizedDescription
                messages.removeAll { $0.id == responseID && $0.text.isEmpty }
            }
            isResponding = false
            currentTool = nil
        }
    }

    func cancel() {
        streamTask?.cancel()
        isResponding = false
        currentTool = nil
    }
}

struct AdvisorView: View {

    @Environment(AppEnvironment.self) private var environment
    @Environment(DataStore.self) private var store
    @State private var model = AdvisorViewModel()
    @State private var isShowingPaywall = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                privacyBanner

                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: Theme.Spacing.medium) {
                            if model.messages.isEmpty { welcome }
                            ForEach(model.messages) { message in
                                MessageBubble(message: message)
                                    .id(message.id)
                            }
                            if let tool = model.currentTool {
                                toolIndicator(tool)
                            }
                            if let error = model.errorMessage {
                                Label(error, systemImage: "exclamationmark.triangle")
                                    .font(.footnote)
                                    .foregroundStyle(Theme.Palette.critical)
                            }
                        }
                        .padding(Theme.Spacing.medium)
                    }
                    .onChange(of: model.messages.last?.text) { _, _ in
                        guard let last = model.messages.last else { return }
                        withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
                    }
                }

                composer
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("tab.advisor")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button {
                            ask("advisor.action.plan", task: .financialPlan)
                        } label: {
                            Label("advisor.action.plan", systemImage: "doc.text")
                        }
                        Button {
                            ask("advisor.action.report", task: .monthlyReport)
                        } label: {
                            Label("advisor.action.report", systemImage: "calendar")
                        }
                        Button {
                            ask("advisor.action.investment", task: .investmentEducation)
                        } label: {
                            Label("advisor.action.investment", systemImage: "chart.line.uptrend.xyaxis")
                        }
                        Divider()
                        Button(role: .destructive) {
                            store.clearChatHistory()
                            model.messages = []
                        } label: {
                            Label("advisor.clear", systemImage: "trash")
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                }
            }
            .sheet(isPresented: $isShowingPaywall) { PaywallView() }
            .onAppear { model.load(from: store) }
        }
    }

    // MARK: Bandeau de confidentialité

    /// Le mode actif est affiché en permanence : l'utilisateur doit savoir à tout moment
    /// si ce qu'il écrit reste sur son appareil.
    private var privacyBanner: some View {
        HStack(spacing: 6) {
            Image(systemName: store.settings.advisorPrivacy == .localOnly
                  ? "lock.fill"
                  : "antenna.radiowaves.left.and.right")
            Text(store.settings.advisorPrivacy.localizedName)
            Spacer()
            NavigationLink { SettingsView() } label: {
                Text("advisor.changePrivacy")
            }
        }
        .font(.caption)
        .foregroundStyle(.secondary)
        .padding(.horizontal, Theme.Spacing.medium)
        .padding(.vertical, 8)
        .background(Color(.secondarySystemGroupedBackground))
    }

    private var welcome: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.medium) {
            Text("advisor.welcome.title")
                .font(.title3.weight(.semibold))
            Text("advisor.welcome.message")
                .font(.subheadline)
                .foregroundStyle(.secondary)

            VStack(alignment: .leading, spacing: Theme.Spacing.small) {
                suggestion("advisor.suggestion.balanced")
                suggestion("advisor.suggestion.save")
                suggestion("advisor.suggestion.invest")
                suggestion("advisor.suggestion.spending")
            }
        }
        .cardStyle()
    }

    private func suggestion(_ key: String) -> some View {
        Button {
            ask(key)
        } label: {
            HStack {
                Text(LocalizedStringKey(key))
                    .font(.subheadline)
                    .multilineTextAlignment(.leading)
                Spacer()
                Image(systemName: "arrow.up.right")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
            .padding(Theme.Spacing.small)
            .background(
                RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                    .fill(Color(.tertiarySystemGroupedBackground))
            )
        }
        .buttonStyle(.plain)
    }

    private func toolIndicator(_ tool: String) -> some View {
        HStack(spacing: 8) {
            ProgressView().controlSize(.small)
            Text(
                String(
                    format: String(localized: "advisor.computing"),
                    String(localized: String.LocalizationValue("tool.\(tool)"))
                )
            )
            .font(.caption)
            .foregroundStyle(.secondary)
        }
    }

    private var composer: some View {
        HStack(spacing: Theme.Spacing.small) {
            TextField("advisor.placeholder", text: $model.input, axis: .vertical)
                .textFieldStyle(.roundedBorder)
                .lineLimit(1...4)
                .disabled(model.isResponding)

            if model.isResponding {
                Button {
                    model.cancel()
                } label: {
                    Image(systemName: "stop.circle.fill").font(.title2)
                }
                .accessibilityLabel("action.stop")
            } else {
                Button {
                    submit(model.input)
                } label: {
                    Image(systemName: "arrow.up.circle.fill").font(.title2)
                }
                .disabled(model.input.trimmingCharacters(in: .whitespaces).isEmpty)
                .accessibilityLabel("action.send")
            }
        }
        .padding(Theme.Spacing.medium)
        .background(.background)
    }

    // MARK: Actions

    /// Les suggestions sont désignées par leur clé de localisation : c'est le texte
    /// réellement affiché qui part au conseiller, pas la clé.
    private func ask(_ key: String, task: AdvisorPrompt.Task = .chat) {
        submit(String(localized: String.LocalizationValue(key)), task: task)
    }

    private func submit(_ text: String, task: AdvisorPrompt.Task = .chat) {
        guard environment.entitlements.has(.advisorChat) else {
            isShowingPaywall = true
            return
        }
        model.send(text, task: task, advisor: environment.advisor, store: store)
    }
}

// MARK: - Bulle de message

struct MessageBubble: View {
    let message: AdvisorMessage

    var body: some View {
        HStack {
            if message.isFromUser { Spacer(minLength: 40) }

            VStack(alignment: message.isFromUser ? .trailing : .leading, spacing: 4) {
                // Le conseiller répond en Markdown léger (gras, listes) : l'afficher tel
                // quel ferait apparaître les astérisques.
                Text(attributed)
                    .font(.subheadline)
                    .textSelection(.enabled)
                    .padding(Theme.Spacing.small)
                    .background(
                        RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                            .fill(message.isFromUser
                                  ? AnyShapeStyle(Theme.Palette.accent.opacity(0.15))
                                  : AnyShapeStyle(Color(.secondarySystemGroupedBackground)))
                    )
            }
            .frame(maxWidth: .infinity, alignment: message.isFromUser ? .trailing : .leading)

            if !message.isFromUser { Spacer(minLength: 40) }
        }
    }

    private var attributed: AttributedString {
        (try? AttributedString(
            markdown: message.text,
            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        )) ?? AttributedString(message.text)
    }
}

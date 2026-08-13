import Foundation
import LocalAuthentication
import Security
import CryptoKit
import Observation

/// Stockage sécurisé des secrets (jeton de relais, sel du code PIN).
///
/// `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` : le secret n'est lisible que
/// lorsque l'appareil est déverrouillé, et il ne migre pas vers un autre appareil
/// via une sauvegarde.
enum KeychainStore {

    private static let service = "app.quantara.secrets"

    enum Key: String {
        case pinHash
        case pinSalt
        case advisorDeviceToken
        case developmentAPIKey
    }

    static func set(_ data: Data, for key: Key) {
        delete(key)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key.rawValue,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        ]
        SecItemAdd(query as CFDictionary, nil)
    }

    static func set(_ string: String, for key: Key) {
        set(Data(string.utf8), for: key)
    }

    static func data(for key: Key) -> Data? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key.rawValue,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess else { return nil }
        return result as? Data
    }

    static func string(for key: Key) -> String? {
        data(for: key).map { String(decoding: $0, as: UTF8.self) }
    }

    static func delete(_ key: Key) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key.rawValue
        ]
        SecItemDelete(query as CFDictionary)
    }

    static func deleteAll() {
        for key in [Key.pinHash, .pinSalt, .advisorDeviceToken, .developmentAPIKey] {
            delete(key)
        }
    }
}

/// Verrouillage de l'application (§17).
///
/// Face ID / Touch ID quand c'est disponible, code PIN en repli. Le code n'est jamais
/// stocké : seul son empreinte salée l'est, ce qui rend l'accès au Trousseau inutile
/// pour retrouver le code.
@MainActor
@Observable
final class AppLockManager {

    enum State: Equatable {
        case unlocked
        case locked
        case authenticating
    }

    private(set) var state: State = .unlocked
    private(set) var lastFailureMessage: String?
    private var lastBackgroundDate: Date?

    var isEnabled: Bool = false
    var autoLockMinutes: Int = 5

    var biometryType: LABiometryType {
        let context = LAContext()
        _ = context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
        return context.biometryType
    }

    var hasPIN: Bool { KeychainStore.data(for: .pinHash) != nil }

    func configure(isEnabled: Bool, autoLockMinutes: Int) {
        self.isEnabled = isEnabled
        self.autoLockMinutes = autoLockMinutes
        if isEnabled && state == .unlocked && lastBackgroundDate == nil {
            state = .locked
        }
    }

    // MARK: Cycle de vie

    func applicationDidEnterBackground() {
        lastBackgroundDate = Date()
    }

    func applicationWillEnterForeground() {
        guard isEnabled else { return }
        guard let last = lastBackgroundDate else { return }
        let elapsed = Date().timeIntervalSince(last) / 60
        if elapsed >= Double(autoLockMinutes) {
            state = .locked
        }
    }

    func lock() {
        guard isEnabled else { return }
        state = .locked
    }

    // MARK: Authentification

    func authenticateWithBiometrics() async {
        guard isEnabled else {
            state = .unlocked
            return
        }
        state = .authenticating
        let context = LAContext()
        context.localizedCancelTitle = String(localized: "lock.usePIN")

        do {
            let reason = String(localized: "lock.reason")
            let success = try await context.evaluatePolicy(
                .deviceOwnerAuthenticationWithBiometrics,
                localizedReason: reason
            )
            state = success ? .unlocked : .locked
            lastFailureMessage = success ? nil : String(localized: "lock.failed")
        } catch {
            state = .locked
            lastFailureMessage = String(localized: "lock.failed")
        }
    }

    // MARK: Code PIN

    /// Enregistre un code. Seule l'empreinte salée est conservée.
    func setPIN(_ pin: String) {
        var salt = Data(count: 32)
        _ = salt.withUnsafeMutableBytes { pointer in
            SecRandomCopyBytes(kSecRandomDefault, 32, pointer.baseAddress!)
        }
        KeychainStore.set(salt, for: .pinSalt)
        KeychainStore.set(Self.hash(pin: pin, salt: salt), for: .pinHash)
    }

    func verifyPIN(_ pin: String) -> Bool {
        guard let salt = KeychainStore.data(for: .pinSalt),
              let stored = KeychainStore.data(for: .pinHash)
        else { return false }
        let candidate = Self.hash(pin: pin, salt: salt)
        // Comparaison à temps constant : une comparaison naïve laisse fuir la longueur
        // du préfixe correct.
        let matches = candidate.count == stored.count
            && zip(candidate, stored).reduce(UInt8(0)) { $0 | ($1.0 ^ $1.1) } == 0
        if matches {
            state = .unlocked
            lastFailureMessage = nil
        } else {
            lastFailureMessage = String(localized: "lock.wrongPIN")
        }
        return matches
    }

    func removePIN() {
        KeychainStore.delete(.pinHash)
        KeychainStore.delete(.pinSalt)
    }

    /// Dérivation par itérations de SHA-256.
    ///
    /// Un code à quatre chiffres n'a que 10 000 combinaisons : l'étirement de clé ne le
    /// rend pas résistant à une attaque hors ligne, mais le Trousseau est déjà protégé
    /// par le matériel. L'étirement évite qu'une empreinte extraite soit inversée
    /// instantanément par table.
    private static func hash(pin: String, salt: Data) -> Data {
        var current = Data(pin.utf8) + salt
        for _ in 0..<120_000 {
            current = Data(SHA256.hash(data: current))
        }
        return current
    }
}

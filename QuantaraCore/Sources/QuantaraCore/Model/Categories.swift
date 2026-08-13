import Foundation

// MARK: - Revenus

public enum IncomeCategory: String, Codable, CaseIterable, Sendable, Identifiable {
    case salary          // Salaire
    case allowances      // Allocations
    case freelance       // Revenus indépendants
    case rental          // Revenus locatifs
    case financial       // Revenus financiers
    case bonus           // Bonus / primes
    case other           // Autres revenus

    public var id: String { rawValue }
    public var localizationKey: String { "income.category.\(rawValue)" }
    public var symbolName: String {
        switch self {
        case .salary:     return "briefcase.fill"
        case .allowances: return "hand.raised.fill"
        case .freelance:  return "laptopcomputer"
        case .rental:     return "house.fill"
        case .financial:  return "chart.line.uptrend.xyaxis"
        case .bonus:      return "gift.fill"
        case .other:      return "ellipsis.circle.fill"
        }
    }

    /// Un revenu régulier peut servir de base au budget ; un revenu irrégulier doit être
    /// lissé (médiane glissante) sous peine de bâtir un budget sur un bon mois.
    public var isTypicallyRegular: Bool {
        switch self {
        case .salary, .allowances, .rental: return true
        case .freelance, .financial, .bonus, .other: return false
        }
    }
}

// MARK: - Dépenses fixes

public enum FixedExpenseCategory: String, Codable, CaseIterable, Sendable, Identifiable {
    case rent
    case mortgage
    case charges
    case electricity
    case gas
    case water
    case internet
    case phone
    case carLoan
    case carInsurance
    case homeInsurance
    case healthInsurance
    case subscriptions
    case school
    case taxes
    case otherLoans
    case otherFixed

    public var id: String { rawValue }
    public var localizationKey: String { "expense.fixed.\(rawValue)" }

    /// Détermine la base du fonds d'urgence : ce qu'il faut continuer de payer si les
    /// revenus s'arrêtent. Les abonnements et les loisirs n'en font pas partie.
    public var isEssential: Bool {
        switch self {
        case .rent, .mortgage, .charges, .electricity, .gas, .water,
             .healthInsurance, .homeInsurance, .school, .taxes,
             .carLoan, .otherLoans, .phone:
            return true
        case .internet, .carInsurance, .subscriptions, .otherFixed:
            return false
        }
    }

    /// Une charge liée à un crédit devrait idéalement être saisie comme une dette,
    /// afin d'alimenter le taux d'endettement et les stratégies de remboursement.
    public var isDebtRelated: Bool {
        switch self {
        case .mortgage, .carLoan, .otherLoans: return true
        default: return false
        }
    }

    public var symbolName: String {
        switch self {
        case .rent, .mortgage:  return "house.fill"
        case .charges:          return "building.2.fill"
        case .electricity:      return "bolt.fill"
        case .gas:              return "flame.fill"
        case .water:            return "drop.fill"
        case .internet:         return "wifi"
        case .phone:            return "iphone"
        case .carLoan:          return "car.fill"
        case .carInsurance:     return "car.circle.fill"
        case .homeInsurance:    return "house.circle.fill"
        case .healthInsurance:  return "cross.case.fill"
        case .subscriptions:    return "repeat.circle.fill"
        case .school:           return "graduationcap.fill"
        case .taxes:            return "building.columns.fill"
        case .otherLoans:       return "creditcard.fill"
        case .otherFixed:       return "ellipsis.circle.fill"
        }
    }
}

// MARK: - Dépenses variables

public enum VariableExpenseCategory: String, Codable, CaseIterable, Sendable, Identifiable {
    case groceries
    case fuel
    case restaurants
    case shopping
    case leisure
    case videoGames
    case travel
    case health
    case transport
    case gifts
    case children
    case pets
    case personal
    case other

    public var id: String { rawValue }
    public var localizationKey: String { "expense.variable.\(rawValue)" }

    public var isEssential: Bool {
        switch self {
        case .groceries, .fuel, .health, .transport, .children:
            return true
        case .restaurants, .shopping, .leisure, .videoGames, .travel,
             .gifts, .pets, .personal, .other:
            return false
        }
    }

    /// Marge de compression réaliste utilisée par le moteur d'optimisation. Réduire les
    /// courses de 40 % n'est pas un conseil, c'est une injonction irréaliste.
    public var compressibility: Decimal {
        switch self {
        case .groceries:   return Decimal(string: "0.15") ?? 0
        case .fuel:        return Decimal(string: "0.10") ?? 0
        case .transport:   return Decimal(string: "0.10") ?? 0
        case .health:      return Decimal(string: "0.05") ?? 0
        case .children:    return Decimal(string: "0.05") ?? 0
        case .restaurants: return Decimal(string: "0.35") ?? 0
        case .shopping:    return Decimal(string: "0.35") ?? 0
        case .leisure:     return Decimal(string: "0.30") ?? 0
        case .videoGames:  return Decimal(string: "0.40") ?? 0
        case .travel:      return Decimal(string: "0.25") ?? 0
        case .gifts:       return Decimal(string: "0.20") ?? 0
        case .pets:        return Decimal(string: "0.10") ?? 0
        case .personal:    return Decimal(string: "0.25") ?? 0
        case .other:       return Decimal(string: "0.20") ?? 0
        }
    }

    public var symbolName: String {
        switch self {
        case .groceries:   return "cart.fill"
        case .fuel:        return "fuelpump.fill"
        case .restaurants: return "fork.knife"
        case .shopping:    return "bag.fill"
        case .leisure:     return "theatermasks.fill"
        case .videoGames:  return "gamecontroller.fill"
        case .travel:      return "airplane"
        case .health:      return "heart.fill"
        case .transport:   return "tram.fill"
        case .gifts:       return "gift.fill"
        case .children:    return "figure.and.child.holdinghands"
        case .pets:        return "pawprint.fill"
        case .personal:    return "person.fill"
        case .other:       return "ellipsis.circle.fill"
        }
    }
}

// MARK: - Catégorie unifiée

/// Catégorie d'une dépense, quel que soit son caractère fixe ou variable.
/// Permet de manipuler indifféremment une transaction ponctuelle et une charge récurrente.
public enum ExpenseCategory: Hashable, Codable, Sendable, Identifiable {
    case fixed(FixedExpenseCategory)
    case variable(VariableExpenseCategory)

    public var id: String {
        switch self {
        case .fixed(let category):    return "fixed.\(category.rawValue)"
        case .variable(let category): return "variable.\(category.rawValue)"
        }
    }

    public var localizationKey: String {
        switch self {
        case .fixed(let category):    return category.localizationKey
        case .variable(let category): return category.localizationKey
        }
    }

    public var symbolName: String {
        switch self {
        case .fixed(let category):    return category.symbolName
        case .variable(let category): return category.symbolName
        }
    }

    public var isEssential: Bool {
        switch self {
        case .fixed(let category):    return category.isEssential
        case .variable(let category): return category.isEssential
        }
    }

    public var isFixed: Bool {
        if case .fixed = self { return true }
        return false
    }

    public var isVariable: Bool { !isFixed }

    public static var allCases: [ExpenseCategory] {
        FixedExpenseCategory.allCases.map(ExpenseCategory.fixed)
            + VariableExpenseCategory.allCases.map(ExpenseCategory.variable)
    }

    /// Reconstruit une catégorie depuis son identifiant stable (persistance, JSON).
    public init?(id: String) {
        let parts = id.split(separator: ".", maxSplits: 1).map(String.init)
        guard parts.count == 2 else { return nil }
        switch parts[0] {
        case "fixed":
            guard let category = FixedExpenseCategory(rawValue: parts[1]) else { return nil }
            self = .fixed(category)
        case "variable":
            guard let category = VariableExpenseCategory(rawValue: parts[1]) else { return nil }
            self = .variable(category)
        default:
            return nil
        }
    }
}

# Launcher UI Modernization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-skin the XMage launcher (`DarrellBest/Launcher`) from Java's cross-platform Metal look-and-feel to FlatLaf dark with the shared "Arcane" accent, matching the modernized client — without changing any launcher behavior.

**Architecture:** Replace the single `UIManager.setLookAndFeel(...)` call in `main()` with FlatLaf dark + Arcane accent + global flat styling, remove the hardcoded button text colors that would be unreadable on a dark surface, and mark the primary launch action as the accent "default" button. Everything else (download/update/launch logic, settings persistence, layout) is untouched.

**Tech Stack:** Java 8, Maven, Swing, FlatLaf 3.7.1 (`com.formdev:flatlaf`), FlatLaf Inter font 4.1 (`com.formdev:flatlaf-fonts-inter`).

**Verification model:** Visual re-skin. Each task's gate is **(a) the project compiles** and **(b) the launcher window opens with no L&F exceptions**. The shared Arcane palette is defined in the client spec; the launcher mirrors its accent (teal `#3DD6C4`) and dark surfaces.

**Reference spec:** `mage-modern` repo → `docs/superpowers/specs/2026-05-25-ui-modernization-design.md`. Work happens in `/home/dbest/projects/Launcher`; commits go to the `DarrellBest/Launcher` fork.

---

## Prerequisites (one-time)

- [ ] **Step 0a: Confirm a baseline build works BEFORE any change**

```bash
cd /home/dbest/projects/Launcher && mvn -q compile
```
Expected: `BUILD SUCCESS`. If this fails before changes, fix the environment first.

- [ ] **Step 0b: Note how to launch the launcher for visual checks**

The main class is `com.xmage.launcher.XMageLauncher`. Launch it (the window opens immediately; the update/check work happening in the background does not block the GUI appearing):
```bash
cd /home/dbest/projects/Launcher && mvn -q exec:java -Dexec.mainClass=com.xmage.launcher.XMageLauncher
```
If `exec:java` is not configured, build and run the assembled jar from `target/`. Note the working command for reuse.

---

## Task 1: Add FlatLaf dependencies

**Files:**
- Modify: `pom.xml` (the `<dependencies>` element, lines ~12–33)

- [ ] **Step 1: Add the dependencies**

Inside the existing `<dependencies>` element in `pom.xml`, add:
```xml
        <dependency>
            <groupId>com.formdev</groupId>
            <artifactId>flatlaf</artifactId>
            <version>3.7.1</version>
        </dependency>
        <dependency>
            <groupId>com.formdev</groupId>
            <artifactId>flatlaf-fonts-inter</artifactId>
            <version>4.1</version>
        </dependency>
```

- [ ] **Step 2: Verify the dependency resolves and compiles**

```bash
mvn -q compile
```
Expected: `BUILD SUCCESS`, FlatLaf jars downloaded.

- [ ] **Step 3: Commit**

```bash
git add pom.xml
git commit -m "build: add FlatLaf and Inter font dependencies"
```

---

## Task 2: Swap Metal → FlatLaf dark with the Arcane accent

**Files:**
- Modify: `src/main/java/com/xmage/launcher/XMageLauncher.java` (`main()`, around lines 490–498)

- [ ] **Step 1: Add imports**

At the top of `XMageLauncher.java`, with the other imports, add:
```java
import com.formdev.flatlaf.FlatDarkLaf;
import java.awt.Insets;
```
(If `java.awt.Insets` is already imported via `java.awt.*` or an explicit import, skip that one.)

- [ ] **Step 2: Replace the look-and-feel setup in main()**

Find:
```java
            UIManager.setLookAndFeel(UIManager.getCrossPlatformLookAndFeelClassName());
```
Replace with:
```java
            // Arcane accent (matches the modernized client) + global flat styling
            UIManager.put("Component.accentColor", new Color(61, 214, 196)); // teal #3DD6C4
            UIManager.put("Component.focusColor", new Color(61, 214, 196));
            UIManager.put("Button.arc", 8);
            UIManager.put("Component.arc", 8);
            UIManager.put("ProgressBar.arc", 8);
            UIManager.put("TextComponent.arc", 6);
            UIManager.put("ScrollBar.thumbArc", 999);
            UIManager.put("ScrollBar.thumbInsets", new Insets(2, 2, 2, 2));
            UIManager.put("Component.focusWidth", 1);
            UIManager.setLookAndFeel(new FlatDarkLaf());
```
(The surrounding `try { ... } catch (... UnsupportedLookAndFeelException ex)` stays; `FlatDarkLaf` setup throws the same checked exception type, so the existing catch is still valid. The `ClassNotFoundException | InstantiationException | IllegalAccessException` parts of the multi-catch remain harmless even if unused.)

- [ ] **Step 3: Verify compile**

```bash
mvn -q compile
```
Expected: `BUILD SUCCESS`.

- [ ] **Step 4: VISUAL CHECKPOINT — launcher is dark + flat**

Launch (Step 0b). Confirm:
- The launcher window opens with a dark, flat FlatLaf look — no Metal bevels.
- No stack trace in the console about the L&F.
- Note: button text may currently look wrong (e.g. dark text on dark) — that's fixed in Task 3.

- [ ] **Step 5: Commit**

```bash
git add src/main/java/com/xmage/launcher/XMageLauncher.java
git commit -m "feat: switch launcher to FlatLaf dark with Arcane accent"
```

---

## Task 3: Fix hardcoded button text colors + mark the primary action

**Files:**
- Modify: `src/main/java/com/xmage/launcher/XMageLauncher.java` (button creation, around lines 203–252)

The buttons hardcode foreground colors that were chosen for the light Metal theme and are unreadable on dark: `btnLaunchClient`, `btnLaunchClientServer`, `btnLaunchServer` use `Color.GRAY`; `btnCheck`, `btnUpdate` use `Color.BLACK`. Removing these lets FlatLaf manage contrast (including the disabled state). We also mark the primary "Launch Client" button as the accent default button.

- [ ] **Step 1: Remove the hardcoded button foregrounds**

Delete these five lines from the button-creation block:
```java
        btnLaunchClient.setForeground(Color.GRAY);
```
```java
        btnLaunchClientServer.setForeground(Color.GRAY);
```
```java
        btnLaunchServer.setForeground(Color.GRAY);
```
```java
        btnCheck.setForeground(Color.BLACK);
```
```java
        btnUpdate.setForeground(Color.BLACK);
```
Leave the `setEnabled(...)`, `setFont(...)`, `setToolTipText(...)`, and `addActionListener(...)` calls intact — only the `setForeground` lines are removed.

- [ ] **Step 2: Mark "Launch Client" as the accent default button**

Immediately after `btnLaunchClient` is constructed (the `btnLaunchClient = new JButton(...)` line), add:
```java
        btnLaunchClient.putClientProperty("JButton.buttonType", "default");
```
This gives the primary action FlatLaf's accent styling when enabled.

- [ ] **Step 3: Verify compile**

```bash
mvn -q compile
```
Expected: `BUILD SUCCESS`. (If `Color` becomes an unused import after removals, that's fine — it's still used elsewhere, e.g. the console `Color.WHITE`/`Color.BLACK`.)

- [ ] **Step 4: VISUAL CHECKPOINT — buttons readable**

Launch. Confirm: all five buttons have readable text on the dark theme; disabled launch buttons look properly "dimmed" (FlatLaf disabled state); after a check/update completes and they enable, "Launch Client" shows the teal accent treatment.

- [ ] **Step 5: Commit**

```bash
git add src/main/java/com/xmage/launcher/XMageLauncher.java
git commit -m "fix: readable button colors on dark theme + accent primary action"
```

---

## Task 4: Console + progress legibility pass

**Files:**
- Modify: `src/main/java/com/xmage/launcher/XMageLauncher.java` (console `textArea`, around lines 160–164)

The console `JTextArea` uses `Color.BLACK` background / `Color.WHITE` text. On the dark theme this is acceptable but reads as a flat black slab; lifting it to a dark surface with a subtle border matches the Arcane palette. This is cosmetic only.

- [ ] **Step 1: Restyle the console surface**

Find:
```java
        textArea.setForeground(Color.WHITE);
        textArea.setBackground(Color.BLACK);
```
Replace with:
```java
        textArea.setForeground(new Color(236, 232, 245)); // off-white #ECE8F5
        textArea.setBackground(new Color(22, 18, 31));     // deep surface #16121F
        textArea.setBorder(javax.swing.BorderFactory.createEmptyBorder(6, 8, 6, 8));
```

- [ ] **Step 2: Verify compile**

```bash
mvn -q compile
```
Expected: `BUILD SUCCESS`.

- [ ] **Step 3: VISUAL CHECKPOINT — console reads well**

Launch and trigger a check/update so log text appears. Confirm the console text is readable on the dark surface and padding looks intentional.

- [ ] **Step 4: Commit**

```bash
git add src/main/java/com/xmage/launcher/XMageLauncher.java
git commit -m "style: modernize launcher console surface"
```

---

## Task 5: Apply the Inter UI font (optional polish, gated)

**Files:**
- Modify: `src/main/java/com/xmage/launcher/XMageLauncher.java` (`main()` and the `Font` definitions)

`setDefaultFonts()` and the main panel build `Font` objects with the `"SansSerif"` family. Switching to Inter completes the modern look. Gated separately: if any label/button clips, revert this task.

- [ ] **Step 1: Add the import**

```java
import com.formdev.flatlaf.fonts.inter.FlatInterFont;
```

- [ ] **Step 2: Install Inter before the L&F is set**

In `main()`, immediately BEFORE the `UIManager.put("Component.accentColor", ...)` lines from Task 2, add:
```java
            FlatInterFont.install();
```

- [ ] **Step 3: Use Inter for the explicitly-created fonts**

In `setDefaultFonts()`, change:
```java
        Font defaultFont = new Font("SansSerif", Font.PLAIN, Config.getInstance().getGuiSize());
```
to:
```java
        Font defaultFont = new Font(FlatInterFont.FAMILY, Font.PLAIN, Config.getInstance().getGuiSize());
```
And in the main panel build (the `fontBig`/`fontSmall`/`fontSmallBold` definitions), change each `"SansSerif"` family to `FlatInterFont.FAMILY`:
```java
        Font fontBig = new Font(FlatInterFont.FAMILY, Font.BOLD, Config.getInstance().getGuiSize() + 2);
        Font fontSmall = new Font(FlatInterFont.FAMILY, Font.PLAIN, Config.getInstance().getGuiSize() - 2);
        Font fontSmallBold = new Font(FlatInterFont.FAMILY, Font.BOLD, Config.getInstance().getGuiSize() - 2);
```

- [ ] **Step 4: Verify compile**

```bash
mvn -q compile
```
Expected: `BUILD SUCCESS`.

- [ ] **Step 5: VISUAL CHECKPOINT — font + clipping**

Launch. Confirm the font is Inter (cleaner than before) and nothing clips in the main window, Settings dialog, or About dialog. If anything clips, **revert this task**.

- [ ] **Step 6: Commit**

```bash
git add src/main/java/com/xmage/launcher/XMageLauncher.java
git commit -m "feat: use Inter as the launcher UI font"
```

---

## Task 6: Final verification

- [ ] **Step 1: Full build**

```bash
mvn -q package -DskipTests
```
Expected: `BUILD SUCCESS`.

- [ ] **Step 2: Final visual confirmation**

Launch the built launcher. Confirm: dark Arcane look, readable buttons with teal primary action, modern console, Settings and About dialogs both open and inherit the theme with no exceptions, and all buttons still trigger their existing actions (check/update/launch) — behavior unchanged.

- [ ] **Step 3: Push the branch (optional, when ready)**

```bash
git push -u origin HEAD
```

---

## Notes for the implementer

- **Behavior is frozen.** Only styling/colors/L&F change. Do not touch the download, update, launch, or settings-persistence logic, or the GridBag layout structure.
- **Shared identity:** the accent teal `#3DD6C4` and dark surfaces here intentionally match the client's Arcane theme so the two apps feel like one product.
- The background JPEG behind the buttons is retained; the dark FlatLaf surfaces + transparent button panel keep it visible. No new image assets are needed.

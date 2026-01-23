# Инструкция для разработчиков

## Важно! Рабочий процесс

**НИКОГДА не пушьте напрямую в ветку `main`!**

Вся разработка ведется только в ветке `develop`.

## Начало работы

1. Клонируйте репозиторий:
```bash
git clone https://github.com/lenin5558dif/platformaai.git
cd platformaai
```

2. Переключитесь на ветку develop:
```bash
git checkout develop
```

3. Установите зависимости:
```bash
npm install
```

4. Запустите сервер для разработки:
```bash
npm run dev
```

## Ежедневная работа

### 1. Перед началом работы - получите последние изменения:
```bash
git checkout develop
git pull origin develop
```

### 2. Вносите изменения в код

### 3. Коммитьте и пушьте ТОЛЬКО в develop:
```bash
git add .
git commit -m "Описание ваших изменений"
git push origin develop
```

### 4. Когда нужно влить изменения в main:
- Создайте Pull Request на GitHub из ветки `develop` в `main`
- Напишите владельцу репозитория для ревью
- После одобрения владелец сольет PR

## ❌ НЕ ДЕЛАЙТЕ ТАК:

```bash
# НЕ переключайтесь на main
git checkout main  # ❌ НЕТ!

# НЕ пушьте в main
git push origin main  # ❌ НЕТ!

# НЕ мержите в main самостоятельно
git merge develop  # ❌ НЕТ!
```

## ✅ ПРАВИЛЬНО:

```bash
# Всегда работайте в develop
git checkout develop  # ✅ ДА!
git push origin develop  # ✅ ДА!

# Для вливания в main - создайте Pull Request на GitHub
```

## Структура веток

- `main` - стабильная версия (только для владельца)
- `develop` - разработка (для всех разработчиков)

## Вопросы?

Если возникли вопросы - свяжитесь с владельцем репозитория.

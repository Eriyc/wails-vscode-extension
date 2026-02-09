package userservice

// User represents a user in the system
type User struct {
	ID    int    `json:"id"`
	Name  string `json:"name"`
	Email string `json:"email"`
}

// UserService handles user-related operations
type UserService struct {
	users []User
}

// GetAllUsers returns all users
// This is the function that GetUsers() in JS bindings will call
func (s *UserService) GetAllUsers() []User {
	return s.users
}

// GetUserByID returns a specific user by ID
func (s *UserService) GetUserByID(id int) *User {
	for _, user := range s.users {
		if user.ID == id {
			return &user
		}
	}
	return nil
}

// CreateUser creates a new user
func (s *UserService) CreateUser(name, email string) User {
	user := User{
		ID:    len(s.users) + 1,
		Name:  name,
		Email: email,
	}
	s.users = append(s.users, user)
	return user
}

// UpdateUser updates an existing user
func (s *UserService) UpdateUser(id int, name, email string) bool {
	for i, user := range s.users {
		if user.ID == id {
			s.users[i].Name = name
			s.users[i].Email = email
			return true
		}
	}
	return false
}

// DeleteUser deletes a user by ID
func (s *UserService) DeleteUser(id int) bool {
	for i, user := range s.users {
		if user.ID == id {
			s.users = append(s.users[:i], s.users[i+1:]...)
			return true
		}
	}
	return false
}
